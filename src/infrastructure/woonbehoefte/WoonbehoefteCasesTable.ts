import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, StreamViewType, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../../Statics';

/**
 * `pk` is `CASE#<caseReference>`. `sk` tells the items within that case apart: `CASE`,
 * `SOURCE#PRIMARY`/`SOURCE#ADDITIONAL#<uuid>`, `NOTE#<createdAt>#<id>`, `ACTIVITY#<occurredAt>#<id>`.
 * None of that comes back from the source (objects) once it's gone, so PITR stays on and the table survives even
 * after the feature itself gets removed.
 */
export class WoonbehoefteCasesTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'table', {
      tableName: Statics.woonbehoefteCasesTableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
      // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });
  }

  /**
   * The sync worker may only conditionally create a new CASE/SOURCE#PRIMARY item (`attribute_not_exists`
   * in the store code) and read back an existing SOURCE#PRIMARY link to decide idempotent-vs-conflict; it
   * deliberately gets no `UpdateItem`/`Query`/`Scan` here so a refresh can never touch a case a medewerker
   * is already processing.
   */
  grantWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:PutItem');
  }

  // The page lambda owns every human mutation: reads, notes/activity puts, conditional case updates and their transact writes.
  // Scan backs the ~400-case overview. ConditionCheckItem is separate from TransactWriteItems: the additional-evidence
  // link transaction includes a standalone ConditionCheck item, which DynamoDB authorizes under its own action.
  grantFrontendAccess(grantee: IGrantable): Grant {
    return this.table.grant(
      grantee,
      'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:TransactWriteItems',
      'dynamodb:ConditionCheckItem',
    );
  }

  // The Excel report worker only ever reads: the ~400-case Scan for the export, Query for a case's source links. Never a write.
  grantReportWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan');
  }
}
