import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/**
 * `pk` is `CASE#<caseReference>`, `sk` is `VERSION#<12-digit padded version>`. Snapshots come from the
 * Cases stream and are never updated or deleted, so PITR is the only recovery path once the stream
 * records themselves expire.
 */
export class WoonbehoefteCaseVersionsTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'table', {
      tableName: Statics.woonbehoefteCaseVersionsTableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  // The version worker only ever creates a new snapshot; it never reads, updates, deletes, queries or scans this table.
  grantWriterAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:PutItem');
  }
}
