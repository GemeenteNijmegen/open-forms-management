import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Statics } from '../../../Statics';

/**
 * `pk` is `CASE#<caseReference>`. `sk` is `WORKVERSION` (de werkversie, één item per dossier),
 * `ATTEMPT` (pogingstatus van de laatste voorinvulling) of `HISTORY#<occurredAt>#<historyId>`
 * (immutable). Een handmatig ingevoerde werkversie komt nergens anders vandaan, dus naast RETAIN
 * en PITR staat hier ook expliciet deletion protection aan.
 */
export class ProjectDetailsTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new Table(this, 'table', {
      tableName: Statics.woonbehoefteProjectDetailsTableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
  }

  // De initializer mag alleen conditioneel een werkversie aanmaken en zijn eigen pogingstatus lezen/schrijven; nooit een bestaande werkversie of history raken.
  grantWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
  }

  // De page Lambda leest, muteert gericht per onderdeel (SET/REMOVE op een Map-entry, nooit de hele werkversie) en schrijft history atomisch mee.
  grantFrontendAccess(grantee: IGrantable): Grant {
    return this.table.grant(
      grantee, 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:TransactWriteItems',
    );
  }

  // De Excel-reportworker leest alleen de actuele werkversie per dossier (GetItem op pk/sk), nooit een Query/Scan en nooit een mutatie.
  grantReportWorkerAccess(grantee: IGrantable): Grant {
    return this.table.grant(grantee, 'dynamodb:GetItem');
  }
}
