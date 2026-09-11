import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const formatDuration = (seconds: number): string => {
  if (!seconds && seconds !== 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export default function DurationBarChart({
  data, xKey, bars, yLabel = 'hrs',
  margin = { top: 10, right: 20, bottom: 60, left: 10 },
  xAngle = -45, xTickSize = 8,
}: {
  data: any[]; xKey: string;
  bars: { dataKey: string; name: string; fill: string }[];
  yLabel?: string;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  xAngle?: number; xTickSize?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: xTickSize }}
          angle={xAngle} textAnchor="end" height={80} interval={0} />
        <YAxis tick={{ fontSize: 10 }}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(value: number) => [formatDuration(value), '']} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {bars.map((bar) => (
          <Bar key={bar.dataKey} dataKey={bar.dataKey} name={bar.name}
            fill={bar.fill} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
