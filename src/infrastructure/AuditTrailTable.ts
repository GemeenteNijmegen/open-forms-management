import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../Statics';

/**
 * `pk` is a fixed constant, the same for every event, `sk` is
 * `<occurredAt>#<eventId>` so the newest events query without a GSI.
 */
export class AuditTrailTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'audit-trail-table', {
      tableName: Statics.auditTrailTableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  // table.grantWriteData() would also allow UpdateItem/DeleteItem/BatchWriteItem; audit records are append-only.
  grantPut(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:PutItem');
  }
}
