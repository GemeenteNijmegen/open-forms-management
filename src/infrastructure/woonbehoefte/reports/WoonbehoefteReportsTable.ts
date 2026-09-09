import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../../../Statics';

/**
 * reportId is the only key, same shape as SportReportsTable. Report volume and retention are small
 * enough that listing the non-deleted reports with a Scan doesn't need a GSI.
 */
export class WoonbehoefteReportsTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'table', {
      tableName: Statics.woonbehoefteReportsTableName,
      partitionKey: { name: 'reportId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  // The worker only updates status/progress on a report the frontend already created; it never creates or deletes one.
  grantWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
  }

  // The frontend creates, lists, reads and soft-deletes (a status update) reports, but never issues a raw DeleteItem.
  grantFrontendAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Scan');
  }
}
