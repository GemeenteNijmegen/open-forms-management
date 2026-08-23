import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/**
 * `pk` is the fixed `SPORT#SUBMISSIONS` partition, `sk` is `OBJECT#<objectUuid>` per submission and
 * `STATE` for the singleton refresh state. One partition, no GSI: `objectUuid` is the only lookup key the
 * worker needs, and the frontend read reads/sorts the (small, TTL-bounded) active set in memory.
 */
export class SportCacheTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'table', {
      tableName: Statics.sportCacheTableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  // The worker looks up known objectUuid's, writes submissions/failure markers and finalizes state; it never queries the full list or deletes.
  grantWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
  }

  // The frontend reads the active set/state and conditionally claims a refresh; it never writes a submission or failure marker itself.
  grantFrontendAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem');
  }
}
