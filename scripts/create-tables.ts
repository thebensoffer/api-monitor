import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: 'us-east-1' });

const tables = [
  {
    TableName: 'api-monitor-logs',
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'timestamp', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
      { AttributeName: 'service', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'service-timestamp-index',
        KeySchema: [
          { AttributeName: 'service', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: 'api-monitor-metrics',
    KeySchema: [
      { AttributeName: 'service', KeyType: 'HASH' },
      { AttributeName: 'date', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'service', AttributeType: 'S' },
      { AttributeName: 'date', AttributeType: 'S' }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  {
    TableName: 'api-monitor-alerts',
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'timestamp', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  // Inbound system-alert emails (populated by openheart-inbound-email-processor
  // Lambda on SES → S3 → SNS fan-out from alerts@{tovanihealth|discreetketamine|drbensoffer}.com).
  // The sparse GSI `untriaged-index` lets the triage cron cheaply find rows
  // where triaged='false'; once processed we REMOVE the attribute so the
  // row falls out of the index.
  {
    TableName: 'api-monitor-inbound-emails',
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'receivedAt', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'receivedAt', AttributeType: 'S' },
      { AttributeName: 'triaged', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'untriaged-index',
        KeySchema: [
          { AttributeName: 'triaged', KeyType: 'HASH' },
          { AttributeName: 'receivedAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },
  // Triage classification results — one row per inbound email the classifier
  // saw. Drives the dashboard Triage tab.
  {
    TableName: 'api-monitor-triage-items',
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'createdAt', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
      { AttributeName: 'bucket', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'by-bucket-created-index',
        KeySchema: [
          { AttributeName: 'bucket', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  }
];

async function createTables() {
  console.log('Creating DynamoDB tables for API Monitor...');
  
  for (const table of tables) {
    try {
      console.log(`Creating table: ${table.TableName}`);
      await client.send(new CreateTableCommand(table));
      console.log(`✓ Created table: ${table.TableName}`);
    } catch (error: any) {
      if (error.name === 'ResourceInUseException') {
        console.log(`⚠ Table ${table.TableName} already exists`);
      } else {
        console.error(`✗ Failed to create table ${table.TableName}:`, error);
      }
    }
  }
  
  console.log('\nTable creation complete!');
}

createTables().catch(console.error);