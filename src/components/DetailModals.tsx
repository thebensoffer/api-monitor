import React from 'react';

interface ServiceStatus {
  key: string;
  name: string;
  status: 'online' | 'warning' | 'error';
  responseTime?: number;
  lastCheck: string;
  error?: string;
  metadata?: Record<string, any>;
}

interface ServiceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  service: ServiceStatus | null;
  title: string;
}

export function ServiceDetailModal({ isOpen, onClose, service, title }: ServiceDetailModalProps) {
  if (!isOpen || !service) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-96 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm font-medium text-gray-500">Service Name</span>
              <p className="text-sm text-gray-900">{service.name}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Status</span>
              <p className={`text-sm font-medium ${
                service.status === 'online' ? 'text-green-600' :
                service.status === 'warning' ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {service.status.toUpperCase()}
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Response Time</span>
              <p className="text-sm text-gray-900">{service.responseTime}ms</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Last Check</span>
              <p className="text-sm text-gray-900">
                {new Date(service.lastCheck).toLocaleString()}
              </p>
            </div>
          </div>
          
          {service.error && (
            <div>
              <span className="text-sm font-medium text-red-500">Error Details</span>
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded mt-1">
                {service.error}
              </p>
            </div>
          )}
          
          {service.metadata && Object.keys(service.metadata).length > 0 && (
            <div>
              <span className="text-sm font-medium text-gray-500">Metadata</span>
              <div className="text-sm text-gray-900 bg-gray-50 p-3 rounded mt-1">
                {Object.entries(service.metadata).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="font-medium">{key}:</span>
                    <span>{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ServicesListModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceStatus[];
  title: string;
  filterStatus?: 'online' | 'warning' | 'error' | 'all';
}

export function ServicesListModal({ isOpen, onClose, services, title, filterStatus = 'all' }: ServicesListModalProps) {
  if (!isOpen) return null;

  const filteredServices = filterStatus === 'all' 
    ? services 
    : services.filter(service => service.status === filterStatus);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-96 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {title} ({filteredServices.length})
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        </div>
        
        <div className="space-y-2">
          {filteredServices.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No services match this filter</p>
          ) : (
            filteredServices.map((service) => (
              <div
                key={service.key}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    service.status === 'online' ? 'bg-green-500' : 
                    service.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                  }`}></div>
                  <div>
                    <p className="font-medium text-gray-900">{service.name}</p>
                    <p className="text-sm text-gray-500">
                      {service.responseTime}ms • {new Date(service.lastCheck).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {service.metadata && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {Object.keys(service.metadata).length} metrics
                    </span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded font-medium ${
                    service.status === 'online' ? 'bg-green-100 text-green-800' :
                    service.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {service.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface PerformanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceStatus[];
  title: string;
}

export function PerformanceModal({ isOpen, onClose, services, title }: PerformanceModalProps) {
  if (!isOpen) return null;

  const servicesWithResponseTime = services.filter(s => s.responseTime);
  const avgResponseTime = servicesWithResponseTime.reduce((acc, s) => acc + (s.responseTime || 0), 0) / servicesWithResponseTime.length;
  const slowestService = servicesWithResponseTime.reduce((prev, curr) => 
    (curr.responseTime || 0) > (prev.responseTime || 0) ? curr : prev
  );
  const fastestService = servicesWithResponseTime.reduce((prev, curr) => 
    (curr.responseTime || 0) < (prev.responseTime || 0) ? curr : prev
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-3xl w-full mx-4 max-h-96 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        </div>
        
        <div className="space-y-4">
          {/* Performance Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{Math.round(avgResponseTime)}ms</div>
              <div className="text-sm text-blue-700">Average Response</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">{fastestService.responseTime}ms</div>
              <div className="text-sm text-green-700">Fastest: {fastestService.name}</div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-600">{slowestService.responseTime}ms</div>
              <div className="text-sm text-red-700">Slowest: {slowestService.name}</div>
            </div>
          </div>

          {/* Performance Chart */}
          <div className="space-y-2">
            <h4 className="font-medium text-gray-900">Response Times by Service</h4>
            {servicesWithResponseTime
              .sort((a, b) => (b.responseTime || 0) - (a.responseTime || 0))
              .map((service) => {
                const percentage = ((service.responseTime || 0) / (slowestService.responseTime || 1)) * 100;
                return (
                  <div key={service.key} className="flex items-center space-x-3">
                    <div className="w-32 text-sm text-gray-700 truncate">{service.name}</div>
                    <div className="flex-1 bg-gray-200 rounded-full h-4 relative">
                      <div 
                        className={`h-4 rounded-full ${
                          (service.responseTime || 0) > avgResponseTime * 1.5 ? 'bg-red-500' :
                          (service.responseTime || 0) > avgResponseTime ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                      <span className="absolute inset-0 flex items-center justify-center text-xs text-gray-800 font-medium">
                        {service.responseTime}ms
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
        
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}