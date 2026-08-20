import * as path from 'path';
import { Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AaaaRecord, ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { Statics } from '../Statics';

export interface ManagementDistributionProps {
  api: HttpApi;
  certificateArn: string;
  wafWebAclArn: string;
  domainName: string;
  hostedZone: IHostedZone;
}

/**
 * The public web entrance: CloudFront in front of the static resources
 * bucket (via OAC) and the HTTP API. Dynamic responses are not cached.
 */
export class ManagementDistribution extends Construct {
  public readonly distribution: Distribution;
  public readonly staticResourcesBucket: Bucket;

  constructor(scope: Construct, id: string, props: ManagementDistributionProps) {
    super(scope, id);

    this.staticResourcesBucket = new Bucket(this, 'static-resources', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // CloudFront standard logging still delivers via a canned ACL, so the destination bucket needs ACLs
    // enabled (OBJECT_WRITER) even though every other bucket in this app uses the ACL-less bucket-owner model.
    const accessLogsBucket = new Bucket(this, 'access-logs', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const securityHeadersPolicy = this.securityHeadersPolicy();

    this.distribution = new Distribution(this, 'distribution', {
      domainNames: [props.domainName],
      certificate: Certificate.fromCertificateArn(this, 'certificate', props.certificateArn),
      webAclId: props.wafWebAclArn,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: accessLogsBucket,
      logIncludesCookies: false,
      // No 401/403 CustomErrorResponse: CloudFront's ErrorCode allowlist excludes 401 entirely, and a
      // CustomErrorResponse for 403 would also swallow AuthorizationService's own rendered "Geen toegang"
      // page. 401 (no Cookie header at all, API Gateway denies before the authorizer runs) and 403 (an
      // invalid session, or an authenticated medewerker without permission) are instead both rewritten to
      // a login redirect by a CloudFront Function, see ADR-029.
      errorResponses: [
        { httpStatus: 500, responseHttpStatus: 500, responsePagePath: '/static/http-errors/500.html', ttl: Duration.seconds(0) },
      ],
      defaultBehavior: {
        // API Gateway receives its own execute-api domain as Host, not the CloudFront custom domain.
        origin: new HttpOrigin(Fn.select(2, Fn.split('/', props.api.apiEndpoint))),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: this.dynamicOriginRequestPolicy(),
        responseHeadersPolicy: securityHeadersPolicy,
        functionAssociations: [{
          function: this.redirectForbiddenToLoginFunction(),
          eventType: FunctionEventType.VIEWER_RESPONSE,
        }],
      },
      additionalBehaviors: {
        '/static/*': {
          origin: S3BucketOrigin.withOriginAccessControl(this.staticResourcesBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: securityHeadersPolicy,
        },
      },
    });

    new BucketDeployment(this, 'static-resources-deployment', {
      sources: [Source.asset('./src/app/static-resources/static')],
      destinationBucket: this.staticResourcesBucket,
      destinationKeyPrefix: 'static',
      distribution: this.distribution,
      distributionPaths: ['/static/*'],
    });

    this.addDnsRecords(props.hostedZone);
  }

  /**
   * Cookies and querystrings are always forwarded: this app is entirely
   * session/redirect driven and does not cache dynamic responses, so
   * over-forwarding here has no cache-key cost.
   */
  private dynamicOriginRequestPolicy() {
    return new OriginRequestPolicy(this, 'dynamic-origin-request-policy', {
      cookieBehavior: OriginRequestCookieBehavior.all(),
      queryStringBehavior: OriginRequestQueryStringBehavior.all(),
      headerBehavior: OriginRequestHeaderBehavior.allowList('Accept', 'Accept-Language'),
    });
  }

  /**
   * Rewrites a 401 (no Cookie header at all, API Gateway denies before the authorizer runs) or 403
   * (session authorizer denial, or AuthorizationService's own "Geen toegang" page) from the origin into a
   * 302 to /login. LoginRequestHandler already redirects an already-logged-in session onward, so the extra
   * hop for a logged-in-but-unauthorized medewerker is harmless. See ADR-029.
   */
  private redirectForbiddenToLoginFunction() {
    return new CloudFrontFunction(this, 'redirect-forbidden-to-login', {
      code: FunctionCode.fromFile({ filePath: path.join(__dirname, 'cloudfront-functions/redirect-forbidden-to-login.js') }),
    });
  }

  // No inline scripts/styles and no external CDN anywhere in this app: the header/footer load same-origin
  // NLDS web-component scripts (nijmegen-header, nijmegen-mobile-menu, nijmegen-toolbar-button), so
  // script-src allows 'self' but nothing wider.
  private securityHeadersPolicy() {
    return new ResponseHeadersPolicy(this, 'security-headers-policy', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; "
            + "script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'",
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });
  }

  /**
   * recordName takes the relative label ("management"), not the full domainName. The account hosted
   * zone is imported via an SSM-parameter lookup, so its zoneName is an unresolved token at synth time;
   * CDK's own FQDN-detection can't match that token against a literal string and would append the zone
   * suffix a second time. A relative label sidesteps that comparison entirely.
   */
  private addDnsRecords(zone: IHostedZone) {
    new ARecord(this, 'a-record', {
      zone,
      recordName: Statics.domainPrefix,
      target: RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
    });
    new AaaaRecord(this, 'aaaa-record', {
      zone,
      recordName: Statics.domainPrefix,
      target: RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
    });
  }
}
