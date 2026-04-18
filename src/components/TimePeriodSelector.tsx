import React from 'react';

interface TimePeriod {
  value: string;
  label: string;
  shortLabel: string;
}

interface TimePeriodSelectorProps {
  selectedPeriod: string;
  onPeriodChange: (period: string) => void;
  className?: string;
}

const TIME_PERIODS: TimePeriod[] = [
  { value: '1d', label: '24 Hours', shortLabel: '24h' },
  { value: '3d', label: '3 Days', shortLabel: '3d' },
  { value: '7d', label: '7 Days', shortLabel: '7d' },
  { value: '15d', label: '15 Days', shortLabel: '15d' },
  { value: '30d', label: '30 Days', shortLabel: '30d' },
  { value: '90d', label: '90 Days', shortLabel: '90d' },
  { value: '6m', label: '6 Months', shortLabel: '6m' },
  { value: '12m', label: '12 Months', shortLabel: '12m' },
  { value: '18m', label: '18 Months', shortLabel: '18m' },
  { value: '5y', label: '5 Years', shortLabel: '5y' }
];

export function TimePeriodSelector({ selectedPeriod, onPeriodChange, className = '' }: TimePeriodSelectorProps) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {TIME_PERIODS.map((period) => (
        <button
          key={period.value}
          onClick={() => onPeriodChange(period.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            selectedPeriod === period.value
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900'
          }`}
          title={period.label}
        >
          {period.shortLabel}
        </button>
      ))}
    </div>
  );
}

export function TimePeriodDropdown({ selectedPeriod, onPeriodChange, className = '' }: TimePeriodSelectorProps) {
  const selectedPeriodObj = TIME_PERIODS.find(p => p.value === selectedPeriod) || TIME_PERIODS[2];
  
  return (
    <select
      value={selectedPeriod}
      onChange={(e) => onPeriodChange(e.target.value)}
      className={`px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${className}`}
    >
      {TIME_PERIODS.map((period) => (
        <option key={period.value} value={period.value}>
          {period.label}
        </option>
      ))}
    </select>
  );
}

export { TIME_PERIODS };