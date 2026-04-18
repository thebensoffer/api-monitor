import React from 'react';

interface LiveStatusIndicatorProps {
  isOnline: boolean;
  lastUpdated?: string;
  autoRefresh?: boolean;
}

export function LiveStatusIndicator({ isOnline, lastUpdated, autoRefresh = true }: LiveStatusIndicatorProps) {
  return (
    <div className="flex items-center space-x-2 text-sm">
      <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
      <span className={`font-medium ${isOnline ? 'text-green-700' : 'text-red-700'}`}>
        {isOnline ? 'Live' : 'Offline'}
      </span>
      {lastUpdated && (
        <span className="text-gray-500">
          • Updated {new Date(lastUpdated).toLocaleTimeString()}
        </span>
      )}
      {autoRefresh && (
        <span className="text-blue-600">
          • Auto-refresh ON
        </span>
      )}
    </div>
  );
}

interface QuickActionButtonsProps {
  onRefresh: () => void;
  onTest: () => void;
  refreshing?: boolean;
}

export function QuickActionButtons({ onRefresh, onTest, refreshing = false }: QuickActionButtonsProps) {
  return (
    <div className="flex items-center space-x-2">
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {refreshing ? (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
        ) : (
          <span className="mr-2">🔄</span>
        )}
        {refreshing ? 'Refreshing...' : 'Refresh'}
      </button>
      
      <button
        onClick={onTest}
        className="inline-flex items-center px-3 py-2 border border-blue-300 shadow-sm text-sm font-medium rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100"
      >
        <span className="mr-2">🧪</span>
        Test API
      </button>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  color?: 'green' | 'blue' | 'yellow' | 'red' | 'purple';
  icon?: string;
  onClick?: () => void;
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  trend, 
  trendValue, 
  color = 'blue',
  icon,
  onClick 
}: MetricCardProps) {
  const colorClasses = {
    green: 'border-green-500 bg-gradient-to-br from-green-50 to-green-100',
    blue: 'border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100',
    yellow: 'border-yellow-500 bg-gradient-to-br from-yellow-50 to-yellow-100',
    red: 'border-red-500 bg-gradient-to-br from-red-50 to-red-100',
    purple: 'border-purple-500 bg-gradient-to-br from-purple-50 to-purple-100'
  };

  const textColorClasses = {
    green: 'text-green-600',
    blue: 'text-blue-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    purple: 'text-purple-600'
  };

  const trendIcons = {
    up: '📈',
    down: '📉',
    stable: '➡️'
  };

  return (
    <div 
      className={`
        p-4 rounded-lg border-l-4 ${colorClasses[color]} 
        ${onClick ? 'cursor-pointer hover:shadow-lg transform hover:scale-105 transition-all' : ''}
      `}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-700">{title}</h4>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      
      <div className={`text-2xl font-bold ${textColorClasses[color]} mb-1`}>
        {value}
      </div>
      
      {subtitle && (
        <p className="text-sm text-gray-600">{subtitle}</p>
      )}
      
      {trend && trendValue && (
        <div className="flex items-center mt-2 text-sm">
          <span className="mr-1">{trendIcons[trend]}</span>
          <span className={`font-medium ${
            trend === 'up' ? 'text-green-600' : 
            trend === 'down' ? 'text-red-600' : 'text-gray-600'
          }`}>
            {trendValue}
          </span>
        </div>
      )}
    </div>
  );
}

interface AlertBannerProps {
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  actions?: Array<{
    label: string;
    onClick: () => void;
    style?: 'primary' | 'secondary';
  }>;
}

export function AlertBanner({ 
  type, 
  title, 
  message, 
  dismissible = false, 
  onDismiss, 
  actions 
}: AlertBannerProps) {
  const typeStyles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    success: 'bg-green-50 border-green-200 text-green-800'
  };

  const icons = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    success: '✅'
  };

  return (
    <div className={`border-l-4 p-4 rounded-r-lg ${typeStyles[type]}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <span className="text-lg">{icons[type]}</span>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <div className="mt-1 text-sm">{message}</div>
          
          {actions && actions.length > 0 && (
            <div className="mt-3 flex space-x-2">
              {actions.map((action, index) => (
                <button
                  key={index}
                  onClick={action.onClick}
                  className={`text-xs px-3 py-1 rounded font-medium ${
                    action.style === 'primary' 
                      ? 'bg-white text-gray-800 hover:bg-gray-100' 
                      : 'text-current hover:underline'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {dismissible && onDismiss && (
          <div className="flex-shrink-0">
            <button
              onClick={onDismiss}
              className="text-current hover:opacity-75"
            >
              <span className="sr-only">Dismiss</span>
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}