import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export const dynamodb = DynamoDBDocumentClient.from(client);

export const TABLES = {
  API_LOGS: process.env.DYNAMODB_API_LOGS_TABLE || 'api-monitor-logs',
  METRICS: process.env.DYNAMODB_METRICS_TABLE || 'api-monitor-metrics', 
  ALERTS: process.env.DYNAMODB_ALERTS_TABLE || 'api-monitor-alerts',
} as const;