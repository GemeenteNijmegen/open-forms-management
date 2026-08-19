import { Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  CachePolicy,
  Distribution,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AaaaRecord, ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

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

    this.distribution = new Distribution(this, 'distribution', {
      domainNames: [props.domainName],
      certificate: Certificate.fromCertificateArn(this, 'certificate', props.certificateArn),
      webAclId: props.wafWebAclArn,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: accessLogsBucket,
      logIncludesCookies: false,
      defaultBehavior: {
        // API Gateway receives its own execute-api domain as Host, not the CloudFront custom domain.
        origin: new HttpOrigin(Fn.select(2, Fn.split('/', props.api.apiEndpoint))),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: this.dynamicOriginRequestPolicy(),
      },
      additionalBehaviors: {
        '/static/*': {
          origin: S3BucketOrigin.withOriginAccessControl(this.staticResourcesBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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

  private addDnsRecords(zone: IHostedZone) {
    new ARecord(this, 'a-record', {
      zone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
    });
    new AaaaRecord(this, 'aaaa-record', {
      zone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
    });
  }
}
