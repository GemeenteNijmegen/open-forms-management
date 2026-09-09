import { Duration } from 'aws-cdk-lib';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Object keys are reports/<reportId>.xlsx, same shape as SportReportsBucket, so the frontend never
 * needs s3:ListBucket to find a report - the DynamoDB record already has its key.
 */
export class WoonbehoefteReportsBucket extends Construct {
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.bucket = new Bucket(this, 'bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(30) }],
    });
  }

  // The worker only ever writes a finished report; it never reads, lists or deletes one.
  grantWorkerAccess(grantee: IGrantable): Grant {
    return this.bucket.grantPut(grantee);
  }

  // GetObject only, deliberately not grantRead: that also grants s3:List* on the bucket itself, which isn't needed.
  grantFrontendAccess(grantee: IGrantable): void {
    Grant.addToPrincipal({ grantee, actions: ['s3:GetObject'], resourceArns: [this.bucket.arnForObjects('*')] });
    this.bucket.grantDelete(grantee);
  }
}
