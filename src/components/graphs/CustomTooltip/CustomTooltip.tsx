import moment from "moment";
import "./CustomTooltip.css";

interface payloadType {
  date: string;
  label: string;
  name: string;
  value: number;
  dataKey: string;
  visits?: number;
  views?: number;
}

interface CustomTooltipPropsType {
  active: boolean;
  payload: {
    name: string;
    value: number;
    dataKey: string;
    payload: payloadType;
    stroke?: string;
  }[];
  isCurrency?: boolean;
  colorList?: string[];
  heading?: string;
  showHeading?: boolean;
  showAsDateKey?: boolean;
  customNames?: string[];
  showKeyNames?: boolean;
  stackHeading?: boolean;
  dataKeys?: string[];
  lineNames?: string[];
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const CustomTooltip = ({
  active,
  payload,
  isCurrency = false,
  colorList = ["#c7910a", "#050317"],
  showHeading = true,
  showKeyNames = true,
  dataKeys = ["visits", "views"],
  lineNames = ["Store Visits", "Product Views"]
}: CustomTooltipPropsType) => {
  if (active && payload?.length) {
    return (
      <div className="custom-tooltip bg-white p-3 font-sans shadow-lg">
        {showHeading && payload[0]?.payload?.label && (
          <p className="heading text-gray-500 text-xs pb-2 mb-2 border-b border-gray-200">
            {payload[0]?.payload?.label}
          </p>
        )}
        
        <div className="space-y-2">
          {payload.map((entry, index) => {
            const dataKeyIndex = dataKeys.indexOf(entry.dataKey);
            const displayName = lineNames[dataKeyIndex] || entry.name;
            const color = colorList[dataKeyIndex] || entry.stroke;
            
            return (
              <div
                className="data-info flex items-center justify-between gap-6"
                key={index}
              >
                <div className="label-content flex items-center gap-2">
                  <div
                    className="marker w-2 h-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="data-name text-gray-600 text-xs font-medium">
                    {displayName}
                  </span>
                </div>
                <span className="data-value text-gray-900 text-xs font-semibold">
                  {isCurrency ? formatCurrency(entry.value) : entry.value.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

export default CustomTooltip;