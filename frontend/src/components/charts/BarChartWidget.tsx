import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function BarChartWidget({
  data, xKey, barKey = 'count', fill = '#3b82f6',
  xAngle = -35,
}: {
  data: any[]; xKey: string; barKey?: string; fill?: string;
  xAngle?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false}
          tick={{ fill: '#64748b', fontSize: 10 }}
          angle={xAngle} textAnchor="end" height={70} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
        <Bar dataKey={barKey} fill={fill} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
