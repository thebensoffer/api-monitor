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