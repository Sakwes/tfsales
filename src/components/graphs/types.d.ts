// types.ts for CustomLineChart

export interface ChartDataPoint {
  label: string; // Date label (e.g., "Jan 04")
  visits: number; // Store visits count
  views: number; // Product views count
  date?: string; // Full date for tooltip (optional)
}

export interface CustomLineChartDataType {
  chartData: ChartDataPoint[];
  colorList?: string[]; // [visitsColor, viewsColor]
  showHeading?: boolean;
  customClass?: string;
  isMoney?: boolean; // Set to false for count data
  dataKeys?: string[]; // ["visits", "views"]
  lineNames?: string[]; // ["Store Visits", "Product Views"]
}