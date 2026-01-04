import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend
} from "recharts";
import CustomTooltip from "./CustomTooltip/CustomTooltip";
import type { CustomLineChartDataType } from "./types";

const CustomLineChart = ({
  chartData,
  colorList = ["#c7910a", "#050317"],
  showHeading = true,
  customClass = "",
  isMoney = false, // Changed default to false for analytics
  dataKeys = ["visits", "views"], // Two lines: visits and views
  lineNames = ["Store Visits", "Product Views"]
}: CustomLineChartDataType) => {
  return (
    <div className={`w-full !text-xs ${customClass}`}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#E5E7EB"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="#9CA3AF"
            tickLine={false}
            tick={{ fill: "#6B7280", fontSize: 12 }}
            dy={10}
          />
          <YAxis
            stroke="#9CA3AF"
            tickLine={false}
            tick={{ fill: "#6B7280", fontSize: 12 }}
            dx={-10}
          />
          <Tooltip
            content={
              <CustomTooltip
                active={false}
                payload={[]}
                colorList={colorList}
                showHeading={showHeading}
                showKeyNames={true}
                isCurrency={isMoney}
                dataKeys={dataKeys}
                lineNames={lineNames}
              />
            }
          />
          {/* <Legend
            wrapperStyle={{ paddingTop: "20px" }}
            iconType="line"
            formatter={(value, entry: any) => {
              const index = dataKeys.indexOf(entry.dataKey);
              return (
                <span style={{ color: "#6B7280", fontSize: "12px" }}>
                  {lineNames[index]}
                </span>
              );
            }}
          /> */}
          
          {/* Store Visits Line */}
          <Line
            type="monotone"
            dataKey={dataKeys[0]}
            stroke={colorList[0]}
            strokeWidth={2}
            dot={{ r: 3, fill: colorList[0] }}
            activeDot={{ r: 5, fill: colorList[0], stroke: "#fff", strokeWidth: 2 }}
            name={lineNames[0]}
          />
          
          {/* Product Views Line */}
          <Line
            type="monotone"
            dataKey={dataKeys[1]}
            stroke={colorList[1]}
            strokeWidth={2}
            dot={{ r: 3, fill: colorList[1] }}
            activeDot={{ r: 5, fill: colorList[1], stroke: "#fff", strokeWidth: 2 }}
            name={lineNames[1]}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CustomLineChart;