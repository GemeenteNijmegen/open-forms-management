import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/**
 * `pk` is the fixed `WOONBEHOEFTE#SUBMISSIONS` partition, `sk` is `SUBMISSION#<objectUuid>` per
 * submission and `STATE` for the singleton refresh state. One partition, no GSI, same shape as
 * `SportCacheTable`. Fully reproducible from Objects/Open Zaak, so `RemovalPolicy.DESTROY` and no
 * point-in-time recovery are acceptable here, unlike the Cases table.
 */
export class WoonbehoefteSourceCacheTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'table', {
      tableName: Statics.woonbehoefteSourceCacheTableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  // The sync worker looks up known objectUuid's, writes submissions/failure markers and claims/finalizes state.
  grantWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
  }

  // The page lambda reads the active submission set/state, batch-reads sources for a case detail, and conditionally claims a refresh; it never writes a submission itself.
  grantFrontendAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:UpdateItem');
  }

  // The Excel report worker reads the ready-submission set for the export and batch-reads linked additional-evidence sources. Never a write.
  grantReportWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query');
  }
}
