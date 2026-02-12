
import React from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceLine,
  Area,
  AreaChart,
  ComposedChart
} from 'recharts';
import { AudioFrame } from '../types';

interface VisualizerProps {
  data: AudioFrame[];
  threshold: number;
  onPointHover?: (distance: number | null) => void;
}

const Visualizer: React.FC<VisualizerProps> = ({ data, threshold, onPointHover }) => {
  const handleMouseMove = (state: any) => {
    if (onPointHover && state && state.activePayload && state.activePayload.length > 0) {
      onPointHover(state.activePayload[0].value);
    }
  };

  const handleMouseLeave = () => {
    if (onPointHover) {
      onPointHover(null);
    }
  };

  return (
    <div className="w-full h-64 bg-slate-900/80 rounded-[2rem] border border-slate-800 shadow-inner overflow-hidden relative group">
      {/* Visual Guide Overlay for Hit Zone */}
      <div 
        className="absolute left-[30px] right-0 bottom-0 bg-emerald-500/5 pointer-events-none transition-all duration-300"
        style={{ height: `${(1 - threshold) * 0}px`, bottom: 0 }} // Purely stylistic if needed
      />
      
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart 
          data={data} 
          margin={{ top: 25, right: 15, left: -15, bottom: 5 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseLeave}
        >
          <defs>
            <linearGradient id="hitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.4} />
          
          <XAxis 
            dataKey="time" 
            hide 
          />
          
          <YAxis 
            domain={[0, 1]} 
            stroke="#475569" 
            fontSize={9} 
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            axisLine={false}
            tickLine={false}
            fontWeight="bold"
          />
          
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#0f172a', 
              border: '1px solid #3b82f6', 
              borderRadius: '20px',
              fontSize: '10px',
              color: '#f8fafc',
              padding: '10px 14px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              borderWidth: '2px'
            }}
            itemStyle={{ color: '#3b82f6', fontWeight: '900' }}
            labelStyle={{ display: 'none' }}
            cursor={{ stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '5 5' }}
            formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, 'Error Distance']}
          />
          
          {/* Shading area BELOW the threshold line to indicate target zone */}
          <ReferenceLine 
            y={threshold} 
            stroke="#ef4444" 
            strokeDasharray="6 6" 
            strokeWidth={2}
            label={{ 
              position: 'insideRight', 
              value: `HIT ZONE < ${(threshold * 100).toFixed(0)}%`, 
              fill: '#ef4444', 
              fontSize: 10,
              fontWeight: '900',
              dy: -15,
              dx: -5
            }} 
          />
          
          <Line 
            type="monotone" 
            dataKey="distance" 
            stroke="#3b82f6" 
            strokeWidth={4} 
            dot={false} 
            isAnimationActive={false}
            connectNulls
            activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default Visualizer;
