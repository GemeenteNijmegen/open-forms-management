import { Logger } from '@aws-lambda-powertools/logger';
import { Statics } from '../Statics';

export const logger = new Logger({
  serviceName: Statics.projectName,
});
