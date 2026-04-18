import React from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface ChartData {
  date: string;
  dateKey: string;
  sessions: number;
  conversions: number;
  users: number;
  conversionRate: string;
}

interface TrafficSource {
  source: string;
  sessions: number;
  percentage: string;
}

interface AnalyticsChartsProps {
  chartData: ChartData[];
  trafficSources: TrafficSource[];
  title: string;
  color: string;
}

// Color palette for charts
const COLORS = {
  dk: {
    primary: '#3b82f6',
    secondary: '#60a5fa',
    accent: '#10b981',
    bg: '#eff6ff'
  },
  dbs: {
    primary: '#10b981',
    secondary: '#34d399',
    accent: '#f59e0b',
    bg: '#f0fdf4'
  }
};

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

export function AnalyticsCharts({ chartData, trafficSources, title, color }: AnalyticsChartsProps) {
  const colorScheme = color === 'blue' ? COLORS.dk : COLORS.dbs;

  // Custom tooltip for time series charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-medium text-gray-900">{`${label}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {`${entry.dataKey === 'conversionRate' ? 'CVR' : entry.dataKey}: ${entry.value}${entry.dataKey === 'conversionRate' ? '%' : ''}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Format traffic sources data for pie chart
  const pieData = trafficSources.slice(0, 5).map((source, index) => ({
    name: source.source.split(' / ')[0] || source.source,
    value: source.sessions,
    percentage: source.percentage,
    fullName: source.source
  }));

  return (
    <div className="space-y-6">
      {/* Sessions & Conversions Line Chart */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h4 className="text-lg font-semibold mb-4 text-gray-900">
          {title} - Sessions & Conversions Over Time
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              stroke="#666"
              fontSize={12}
              angle={chartData.length > 10 ? -45 : 0}
              textAnchor={chartData.length > 10 ? 'end' : 'middle'}
              height={chartData.length > 10 ? 60 : 30}
            />
            <YAxis stroke="#666" fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="sessions"
              stroke={colorScheme.primary}
              strokeWidth={3}
              dot={{ fill: colorScheme.primary, strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: colorScheme.primary, strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="conversions"
              stroke={colorScheme.accent}
              strokeWidth={2}
              dot={{ fill: colorScheme.accent, strokeWidth: 2, r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Users Area Chart */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h4 className="text-lg font-semibold mb-4 text-gray-900">
          {title} - User Growth
        </h4>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              stroke="#666"
              fontSize={12}
              angle={chartData.length > 10 ? -45 : 0}
              textAnchor={chartData.length > 10 ? 'end' : 'middle'}
              height={chartData.length > 10 ? 60 : 30}
            />
            <YAxis stroke="#666" fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="users"
              stroke={colorScheme.secondary}
              fill={colorScheme.secondary}
              fillOpacity={0.3}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Traffic Sources Pie Chart */}
      {pieData.length > 0 && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h4 className="text-lg font-semibold mb-4 text-gray-900">
            {title} - Traffic Sources
          </h4>
          <div className="flex flex-col lg:flex-row items-center">
            <div className="w-full lg:w-1/2">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: any, name: any, props: any) => [
                      `${value} sessions (${props.payload.percentage})`,
                      props.payload.fullName
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full lg:w-1/2 lg:pl-6">
              <div className="space-y-3">
                {pieData.map((source, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="text-sm font-medium text-gray-700 truncate">
                        {source.fullName}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {source.value} ({source.percentage})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conversion Rate Bar Chart */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h4 className="text-lg font-semibold mb-4 text-gray-900">
          {title} - Conversion Rate Trend
        </h4>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              stroke="#666"
              fontSize={12}
              angle={chartData.length > 10 ? -45 : 0}
              textAnchor={chartData.length > 10 ? 'end' : 'middle'}
              height={chartData.length > 10 ? 60 : 30}
            />
            <YAxis 
              stroke="#666" 
              fontSize={12}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip 
              formatter={(value: any) => [`${value}%`, 'Conversion Rate']}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Bar
              dataKey="conversionRate"
              fill={colorScheme.accent}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}