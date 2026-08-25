import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Holds a large Open Zaak document just long enough to hand the medewerker a short-lived presigned
 * GetObject URL instead of proxying the bytes through API Gateway/Lambda. The 1-day lifecycle expiration
 * is a backstop, not the real retention: the presigned URL itself expires in 60 seconds.
 */
export class WoonbehoefteTemporaryDownloadsBucket extends Construct {
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.bucket = new Bucket(this, 'bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [{ expiration: Duration.days(1) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }

  // Object-level only: the page lambda writes the document once and reads it back for the presigned URL, never lists or deletes.
  grantFrontendAccess(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({ grantee, actions: ['s3:PutObject', 's3:GetObject'], resourceArns: [this.bucket.arnForObjects('*')] });
  }
}
