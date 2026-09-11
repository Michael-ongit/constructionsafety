/**
 * SiteMonitor AI — Frontend Application (App.tsx)
 *
 * This is the single main React component (~10,800 lines) that handles ALL
 * pages, routing, data fetching, and state management for the entire app.
 *
 * Architecture overview:
 *   - State-driven routing via `activePage` (no React Router)
 *   - Role-based access: 'site' (Site Engineer), 'ehs' (EHSO), 'super_admin'
 *   - All API calls use plain `fetch()` proxied through Vite to the FastAPI backend
 *   - Mobile and desktop share the same component; CSS breakpoints control layout
 *
 * Major sections:
 *   1. Imports & utilities  (lines 1-90)
 *   2. Types & interfaces   (lines 92-250)
 *   3. Utility components   (lines 252-600) — UaucStatusBadge, SearchableSelect, etc.
 *   4. LoginPage            (lines 600-1200)
 *   5. Sidebar / Nav        (lines 1200-1400)
 *   6. Dashboard            (lines 1400-1800)
 *   7. Executive Dashboard  (lines 1800-2400)
 *   8. Safety Analytics     (lines 2400-2700)
 *   9. Incidents & Logs     (lines 2700-3100)
 *  10. UAUC List (My Tasks) (lines 3100-4000)
 *  11. UAUC Capture (Audit) (lines 4000-5000)
 *  12. UAUC Approval        (lines 5000-5500)
 *  13. Admin Panel          (lines 5500-5700)
 *  14. Mobile Views         (lines 5700-10000)
 *  15. Main App render      (lines 10000-10790)
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef, Suspense } from 'react';
import { analyzePPECompliance } from './services/geminiService';
import { cachedFetch, clearCache, authFetch } from './services/apiCache';
import { 
  LayoutDashboard, Video, AlertTriangle, BarChart3, Search, ShieldCheck,
  HardHat, Map, ChevronRight, ChevronDown, Filter, Download, Eye, CheckCircle2,
  Clock, Activity, Maximize2, X, Plus, Camera, Zap, Users, Upload,
  Image as ImageIcon, Cloud, ArrowUp, ClipboardCheck, History, Database, Save,
  TrendingUp, BarChart2, LayoutGrid, GripVertical, Edit3, Trash2, Menu,
  ChevronLeft, ChevronUp, FileText, CheckSquare, Calendar, Flag, Lock, Send,
  LogOut, EyeOff, Loader2, MapPin, Check, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatActivity, getIdealTime } from './lib/utils';
import { SpeechInput, SpeechTextarea } from './components/SpeechInput';
import ChatWidget from './components/chatbot/ChatWidget';

// Lazy-loaded chart widgets (code-split for performance)
const BarChartWidget = React.lazy(() => import('./components/charts/BarChartWidget'));
const MonthlyBarChart = React.lazy(() => import('./components/charts/MonthlyBarChart'));
const DurationBarChart = React.lazy(() => import('./components/charts/DurationBarChart'));
const MonthlyAvgCloseLineChart = React.lazy(() => import('./components/charts/MonthlyAvgCloseLineChart'));

// ---------------------------------------------------------------------------
// Client-side image compression helper
// ---------------------------------------------------------------------------
function compressImage(file: File, maxW: number = 1920, quality: number = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxW || height > maxW) {
        const ratio = Math.min(maxW / width, maxW / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Page = 'dashboard' | 'executive-dashboard' | 'supervision' | 'safety-analytics' | 'activity-logs' | 'activity-analytics' | 
  'audit' | 'settings' | 'incidents' | 'profile' | 'search-results' | 'my-uaucs' | 'my-uaucs-detail' | 'demo' | 'my-tasks-init' | 'uauc-approval' | 'uauc-closure' | 'mobile-workspace-loader' | 'mobile-home' | 'admin' | 'project-dashboard' | 'individual-dashboard' | 'site-dashboard';

interface Camera {
  id: string;
  name: string;
  zone: string;
  status: string;
  detection: string;
  videoUrl?: string;
  type: 'static' | 'webcam';
}

interface ActivityLog {
  id?: string;
  project: string;
  zone: string;
  activity: string;
  startTime: string;
  endTime: string;
  totalIdleTime: string;
  totalIdleSeconds: number;
  totalWorkSeconds: number;
  count: number;
  day?: string;
  time?: string;
  cameraZone?: string;
  imageUrl?: string;
  action?: string;
  detections?: any[];
}

interface Incident {
  id: string;
  timestamp: string;
  cameraZone: string;
  unsafeActivity: string;
  status: 'Violation Recorded' | 'Warning Issued' | 'Critical Alert Sent' | 'Logged';
  risk: 'low' | 'medium' | 'high' | 'critical';
  imageUrl?: string | null;
  hasImage: boolean;
  oneDriveUrl?: string;
  localPath?: string;
}


// ─── Image Viewer Modal ───────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Incident image lightbox modal
// ---------------------------------------------------------------------------
const IncidentImageModal = ({
  item, remarkState, onClose, onRemarkChange, onRemarkSave, formatDate, isMobile,
}: {
  item: any;
  remarkState: Record<number, { value: string; saving: boolean; saved: boolean }>;
  onClose: () => void;
  onRemarkChange: (id: number, value: string) => void;
  onRemarkSave: (id: number) => void;
  formatDate: (d: string) => string;
  isMobile?: boolean;
}) => {
  const [imgStatus, setImgStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const imageUrl = `/api/incidents/${item.id}/image`;
  const rs = remarkState[item.id] ?? { value: item.remark || '', saving: false, saved: false };

    const downloadAsPDF = async () => {
    if (imgStatus !== 'ok') return;
    
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      const imgLoaded = new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve();
        } else {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = imageUrl;
        }
      });
      
      await imgLoaded;
      
      let yPos = 20;
      const lineHeight = 6;
      const headerSpace = 8;
      const sectionGap = 18;
      
      const checkPageBreak = (required: number) => {
        if (yPos > 270) {
          pdf.addPage();
          yPos = 20;
        }
      };
      
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Safety Incident Report #${item.id}`, 20, yPos);
      yPos += sectionGap;
      
      if (img.naturalWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        
        const imgHeight = Math.min(100, (img.naturalHeight * 170) / img.naturalWidth);
        checkPageBreak(imgHeight + 40);
        pdf.addImage(imgData, 'JPEG', 20, yPos, 170, imgHeight, undefined, 'FAST');
        yPos += imgHeight + sectionGap;
      }
      
      checkPageBreak(50);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Incident Details', 20, yPos);
      yPos += headerSpace;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Date: ${formatDate(item.date)} | Zone: ${item.camera_zone || 'Unknown'}`, 25, yPos);
      yPos += sectionGap;
      
      checkPageBreak(20);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('1. Risk Level', 20, yPos);
      yPos += headerSpace;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`- ${item.risk || 'N/A'}`, 35, yPos);
      yPos += sectionGap;
      
      checkPageBreak(30);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('2. Unsafe Activities', 20, yPos);
      yPos += headerSpace;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const unsafeLines = pdf.splitTextToSize(item.unsafe_activity || 'N/A', 155);
      pdf.text(unsafeLines, 30, yPos);
      yPos += unsafeLines.length * lineHeight + sectionGap;
      
      checkPageBreak(30);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('3. Recommendation', 20, yPos);
      yPos += headerSpace;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const recLines = pdf.splitTextToSize(item.recommendation || 'N/A', 155);
      pdf.text(recLines, 30, yPos);
      
      if (rs.value) {
        yPos += recLines.length * lineHeight + sectionGap;
        checkPageBreak(20);
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text('4. Remarks', 20, yPos);
        yPos += headerSpace;
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        const remarkLines = pdf.splitTextToSize(rs.value, 155);
        pdf.text(remarkLines, 30, yPos);
      }
      
      pdf.save(`Incident_${item.id}_Report.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Could not generate PDF. Please try again.');
    }
  };

  return (
    <div className={cn("fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm", isMobile ? "p-0" : "p-4")}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className={cn("bg-white shadow-2xl w-full overflow-hidden flex flex-col", isMobile ? "h-full rounded-none" : "max-w-4xl rounded-3xl lg:flex-row max-h-[90vh]")}>
        <div className="flex-1 bg-slate-900 relative flex items-center justify-center min-h-[280px] overflow-hidden">
          {imgStatus === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900">
              <Activity className="animate-spin mb-3 text-blue-400" size={36} />
              <p className="text-xs text-slate-400">Loading image…</p>
            </div>
          )}
          {imgStatus === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-slate-900 z-10">
              <ImageIcon size={48} className="mb-3 opacity-20" />
              <p className="text-sm text-slate-400">No image available for this incident.</p>
            </div>
          )}
          <img src={imageUrl} alt={`Incident #${item.id}`} loading="lazy" decoding="async"
            onLoad={() => setImgStatus('ok')} onError={() => setImgStatus('error')}
            className={cn("w-full h-full object-contain max-h-[70vh] transition-opacity duration-300", imgStatus === 'ok' ? 'opacity-100' : 'opacity-0')}
          />
          <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
            <span className={cn("text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider",
              (item.risk||'').toLowerCase()==='high' ? "bg-rose-500 text-white" :
              (item.risk||'').toLowerCase()==='medium' ? "bg-orange-500 text-white" : "bg-emerald-500 text-white")}>
              {item.risk || 'Unknown'} Risk
            </span>
            <span className="text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider bg-black/40 text-white backdrop-blur-sm">#{item.id}</span>
          </div>
        </div>
        <div className="w-full lg:w-72 flex flex-col bg-white overflow-y-auto shrink-0">
          <div className="p-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <AlertTriangle className="text-rose-500" size={14} /> Incident #{item.id}
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(item.date)} at {item.time}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={downloadAsPDF} className="p-1.5 hover:bg-rose-100 rounded-full transition-colors text-rose-600" title="Download PDF">
                <Download size={14} />
              </button>
              <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors">
                <X size={14} className="text-slate-400" />
              </button>
            </div>
          </div>
          <div className="p-3 space-y-2 flex-1">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-slate-50 rounded-lg">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Camera Zone</p>
                <p className="text-xs font-bold text-slate-900 truncate">{item.camera_zone || 'Unknown'}</p>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Risk Level</p>
                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                  (item.risk||'').toLowerCase()==='high' ? "bg-rose-100 text-rose-600" :
                  (item.risk||'').toLowerCase()==='medium' ? "bg-orange-100 text-orange-600" :
                  (item.risk||'').toLowerCase()==='low' ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-600")}>
                  {item.risk || 'N/A'}
                </span>
              </div>
            </div>
            <div className="p-2 bg-orange-50 rounded-lg border border-orange-100">
              <p className="text-[9px] font-bold text-orange-600 uppercase tracking-wider mb-1">Unsafe Activity</p>
              <div className="space-y-0.5">
                {(item.unsafe_activity || 'N/A').split(/\d+\.\s+/).filter(Boolean).map((act: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-1">
                    <span className="text-orange-400 font-bold text-[9px] shrink-0 mt-0.5">{idx+1}.</span>
                    <span className="text-xs font-medium text-orange-800 leading-tight">{act.trim()}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wider mb-0.5">Recommendation</p>
              <p className="text-xs text-blue-800 leading-tight">{item.recommendation || 'N/A'}</p>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Remarks</p>
              <div className="flex gap-1.5">
                <SpeechInput value={rs.value}
                  onChange={(e) => onRemarkChange(item.id, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onRemarkSave(item.id)}
                  placeholder="Add remarks…"
                  className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button onClick={() => onRemarkSave(item.id)} disabled={rs.saving}
                  className={cn("px-2 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap",
                    rs.saved ? "bg-emerald-100 text-emerald-700" :
                    rs.saving ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
                    "bg-blue-600 text-white hover:bg-blue-700")}>
                  {rs.saving ? 'Saving…' : rs.saved ? '✓' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          <div className="p-3 border-t border-slate-100 bg-slate-50">
            <button onClick={onClose} className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all">Close</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// Safety Model Component - Dedicated page for Safety_Model table
// ---------------------------------------------------------------------------
// Safety model page — AI-detected incidents list with filtering
// ---------------------------------------------------------------------------
const SafetyModelPage = React.memo(({ isMobile }: { isMobile?: boolean }) => {
  const [safetyData, setSafetyData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZone, setSelectedZone] = useState<string>('All');
  const [selectedProject, setSelectedProject] = useState<string>('All');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [remarkState, setRemarkState] = useState<Record<number, { value: string; saving: boolean; saved: boolean }>>({});
  const [currentTablePage, setCurrentTablePage] = useState(1);
  const [imageModalItem, setImageModalItem] = useState<any | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);

  const fetchData = async (page: number = 1) => {
    try {
      const skip = (page - 1) * 50;
      let url = `/api/safety-model?limit=50&skip=${skip}`;
      
      if (selectedZone !== 'All') url += `&camera_zone=${selectedZone}`;
      if (startDate) url += `&start_date=${startDate}`;
      if (endDate) url += `&end_date=${endDate}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const [dataRes, statsRes] = await Promise.all([
        fetch(url, { signal: controller.signal }),
        fetch('/api/safety-model/stats', { signal: controller.signal })
      ]);
      clearTimeout(timeoutId);
      
      if (!dataRes.ok) throw new Error('Failed to fetch');
      
      const data = await dataRes.json();
      const statsData = await statsRes.json();
      
      setSafetyData(data.data || []);
      setStats(statsData);
      setTotalRecords(data.total || 0);
      setCurrentTablePage(page);
      
      const initial: Record<number, { value: string; saving: boolean; saved: boolean }> = {};
      (data.data || []).forEach((item: any) => { 
        initial[item.id] = { value: item.remark || '', saving: false, saved: false }; 
      });
      setRemarkState(initial);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch safety model data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData(1);
  }, [selectedZone, startDate, endDate]);

  const formatDate = (dateStr: string) => {
    try { return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return dateStr; }
  };

  const parseNumberedList = (text: string): string[] => {
    if (!text) return [];
    // Split by numbered items (1., 2., etc.) and clean up
    const parts = text.split(/(?=\d+\.\s)/)
      .map(s => s.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [text.trim()];
  };

  // Parse individual activities from numbered list for counting
  const parseActivityForCount = (text: string): string => {
    if (!text) return "Unknown";
    // Take only the first line/item if it's a numbered list
    const firstItem = text.split(/(?=\d+\.\s)/)[0];
    return firstItem.replace(/^\d+\.\s*/, '').trim() || "Unknown";
  };

  const uniqueZones = Array.from(new Set(safetyData.map(i => i.camera_zone || ''))).filter(Boolean);
  const uniqueProjects = Array.from(new Set(safetyData.map(i => i.project || ''))).filter(Boolean);

  const handleRemarkChange = (id: number, value: string) => {
    setRemarkState(prev => ({ ...prev, [id]: { ...prev[id], value, saved: false } }));
  };

  const handleRemarkSave = async (id: number) => {
    const current = remarkState[id];
    if (!current) return;
    setRemarkState(prev => ({ ...prev, [id]: { ...prev[id], saving: true } }));
    try {
      const res = await fetch(`/api/safety-model/${id}/remark`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: current.value }),
      });
      if (!res.ok) throw new Error('Save failed');
      setRemarkState(prev => ({ ...prev, [id]: { ...prev[id], saving: false, saved: true } }));
      setTimeout(() => setRemarkState(prev => ({ ...prev, [id]: { ...prev[id], saved: false } })), 2000);
    } catch {
      setRemarkState(prev => ({ ...prev, [id]: { ...prev[id], saving: false } }));
      alert('Failed to save remark.');
    }
  };

  const handleExportPDF = async () => {
    if (safetyData.length === 0) {
      alert('No incidents to export');
      return;
    }
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      let yPos = 20;
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Safety Incidents Report', 20, yPos);
      yPos += 10;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos);
      yPos += 10;
      pdf.text(`Total Incidents: ${safetyData.length} (Page ${currentTablePage})`, 20, yPos);
      yPos += 15;
      for (let i = 0; i < Math.min(safetyData.length, 15); i++) {
        const item = safetyData[i];
        if (yPos > 260) { pdf.addPage(); yPos = 20; }
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Incident #${item.id}`, 20, yPos);
        yPos += 6;
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Date: ${formatDate(item.date)} | Time: ${item.time}`, 20, yPos);
        yPos += 5;
        pdf.text(`Zone: ${item.camera_zone || 'N/A'} | Risk: ${item.risk || 'N/A'}`, 20, yPos);
        yPos += 5;
        pdf.text(`Activity: ${item.unsafe_activity || 'N/A'}`, 20, yPos);
        yPos += 10;
        pdf.setDrawColor(200, 200, 200);
        pdf.line(20, yPos, 190, yPos);
        yPos += 10;
      }
      if (safetyData.length > 15) {
        pdf.setFontSize(10);
        pdf.text(`... and ${safetyData.length - 15} more incidents on this page.`, 20, yPos);
      }
      pdf.save(`Safety_Incidents_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Failed to generate PDF');
    }
  };

  const handleExport = async () => {
    const dataToExport = safetyData.map(item => ({
      'ID': item.id, 'Date': formatDate(item.date), 'Time': item.time,
      'Camera Zone': item.camera_zone || '', 'Unsafe Activity': item.unsafe_activity || '',
      'Risk': item.risk || 'N/A', 'Recommendation': item.recommendation || 'N/A',
      'Remarks': remarkState[item.id]?.value || item.remark || '',
    }));
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Safety_Model");
    XLSX.writeFile(wb, `Safety_Model_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 page-enter">
        <div className="flex items-center justify-between mb-2">
          <div className="space-y-2">
            <div className="skeleton h-6 w-40" />
            <div className="skeleton h-3 w-56" />
          </div>
          <div className="skeleton h-9 w-28 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-9 flex-1 rounded-lg" />
          <div className="skeleton h-9 w-28 rounded-lg" />
          <div className="skeleton h-9 w-28 rounded-lg" />
          <div className="skeleton h-9 w-20 rounded-lg" />
        </div>
        <div className="skeleton h-[200px] w-full rounded-xl" />
        <div className="space-y-2">
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Safety Incidents</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all">
            <Download size={16} /> Export Data
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex flex-col md:flex-row gap-3 flex-wrap items-center">
          {uniqueProjects.length > 0 && (
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none min-w-[140px]">
              <option value="All">All Projects</option>
              {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none min-w-[140px]">
            <option value="All">All Zones</option>
            {uniqueZones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium hidden sm:inline">From:</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium hidden sm:inline">To:</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none"
            />
          </div>
          <div className="flex-1 relative min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <SpeechInput placeholder="Search by zone, activity, risk..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); }}
              className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-200 transition-colors">
              Clear Dates
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Safety Incidents</h3>
            <p className="text-sm text-slate-500">Showing {safetyData.length > 0 ? `1-${safetyData.length}` : '0'} of {totalRecords} total records</p>
          </div>
        </div>
        {isMobile ? (
          <div className="divide-y divide-slate-100">
            {safetyData.map((item) => {
              const rs = remarkState[item.id] ?? { value: item.remark || '', saving: false, saved: false };
              const activityItems = parseNumberedList(item.unsafe_activity || 'N/A');
              const riskItems = parseNumberedList(item.risk || 'N/A');
              const recItems = parseNumberedList(item.recommendation || 'N/A');
              return (
                <div key={item.id} className="p-4 space-y-3 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{formatDate(item.date)}</span>
                      <span className="text-xs text-slate-500 font-mono">{item.time}</span>
                    </div>
                    <button onClick={() => setImageModalItem(item)}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
                      <Eye size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Project</span>
                      <p className="font-medium text-slate-900">{item.project || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Zone</span>
                      <p className="font-medium text-slate-900">{item.camera_zone || 'Unknown'}</p>
                    </div>
                  </div>
                  {activityItems.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Unsafe Activity</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {activityItems.map((act, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-[10px] font-medium">{act}</span>
                        ))}
                      </div>
                    </div>
                  )}
          <div className="flex flex-nowrap gap-2">
                    {riskItems.map((r, idx) => (
                      <span key={idx} className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        r.toLowerCase().includes('high') ? "bg-rose-100 text-rose-600" :
                        r.toLowerCase().includes('medium') ? "bg-orange-100 text-orange-600" :
                        r.toLowerCase().includes('low') ? "bg-emerald-100 text-emerald-600" :
                        "bg-slate-100 text-slate-600")}>
                        {r}
                      </span>
                    ))}
                    {recItems.map((rec, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">{rec}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <SpeechInput value={rs.value}
                      onChange={(e) => handleRemarkChange(item.id, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRemarkSave(item.id)}
                      placeholder="Add remarks..."
                      className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 min-h-[36px]"
                    />
                    <button onClick={() => handleRemarkSave(item.id)} disabled={rs.saving}
                      className={cn("px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[36px]",
                        rs.saved ? "bg-emerald-100 text-emerald-700" :
                        rs.saving ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
                        "bg-blue-600 text-white hover:bg-blue-700")}>
                      {rs.saving ? '…' : rs.saved ? '✓' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Time</th>
                        <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                  <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Zone</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Unsafe Activity</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Risk</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recommendation</th>
                  <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remarks</th>
                  <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Image</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {safetyData.map((item) => {
                const rs = remarkState[item.id] ?? { value: item.remark || '', saving: false, saved: false };
                const activityItems = parseNumberedList(item.unsafe_activity || 'N/A');
                const riskItems = parseNumberedList(item.risk || 'N/A');
                const recItems = parseNumberedList(item.recommendation || 'N/A');
                return (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors align-top">
                    <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.date)}</td>
                    <td className="px-3 py-3 text-xs text-slate-600 font-mono whitespace-nowrap">{item.time}</td>
                    <td className="px-3 py-3 text-xs font-medium text-slate-900">{item.project || 'N/A'}</td>
                    <td className="px-3 py-3 text-xs font-medium text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0" />
                        {item.camera_zone || 'Unknown'}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="space-y-1">
                        {activityItems.map((act, idx) => (
                          <div key={idx} className="flex items-start gap-1.5">
                            <span className="text-orange-400 font-bold text-[10px] shrink-0 w-3">{idx+1}.</span>
                            <span className="px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded text-[10px] font-medium leading-snug">{act}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      <div className="space-y-1">
                        {riskItems.map((r, idx) => (
                          <div key={idx} className="flex items-start gap-1.5">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase leading-snug",
                              r.toLowerCase().includes('high') ? "bg-rose-100 text-rose-600" :
                              r.toLowerCase().includes('medium') ? "bg-orange-100 text-orange-600" :
                              r.toLowerCase().includes('low') ? "bg-emerald-100 text-emerald-600" :
                              "bg-slate-100 text-slate-600")}>
                              {r}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <div className="space-y-1">
                        {recItems.map((rec, idx) => (
                          <div key={idx} className="flex items-start gap-1.5">
                            <span className="text-blue-400 font-bold text-[10px] shrink-0 w-3">{idx+1}.</span>
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium leading-snug">{rec}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 min-w-[150px]">
                        <SpeechInput value={rs.value}
                          onChange={(e) => handleRemarkChange(item.id, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRemarkSave(item.id)}
                          placeholder="Add remarks..."
                          className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                        <button onClick={() => handleRemarkSave(item.id)} disabled={rs.saving}
                          className={cn("px-2 py-1 rounded text-xs font-medium transition-all whitespace-nowrap",
                            rs.saved ? "bg-emerald-100 text-emerald-700" :
                            rs.saving ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
                            "bg-blue-600 text-white hover:bg-blue-700")}>
                          {rs.saving ? '…' : rs.saved ? '✓' : 'Save'}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => setImageModalItem(item)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="View Image">
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
         <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {totalRecords > 0 ? `${(currentTablePage-1)*50+1}–${Math.min(currentTablePage*50, totalRecords)}` : '0'} of {totalRecords} records
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => fetchData(currentTablePage-1)} disabled={currentTablePage===1}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50">Previous</button>
            {Array.from({ length: Math.ceil(totalRecords/50) }, (_,i)=>i+1)
              .slice(Math.max(0,currentTablePage-3), Math.min(Math.ceil(totalRecords/50), currentTablePage+2))
              .map(page => (
                <button key={page} onClick={() => fetchData(page)}
                  className={cn("px-3 py-1.5 text-xs rounded-md",
                    currentTablePage===page ? "bg-blue-600 text-white" : "border border-slate-200 hover:bg-slate-50")}>
                  {page}
                </button>
              ))}
            <button onClick={() => fetchData(currentTablePage+1)} disabled={currentTablePage>=Math.ceil(totalRecords/50)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50">Next</button>
          </div>
        </div>
        {safetyData.length === 0 && !loading && (
          <div className="p-12 text-center">
            <Database size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Data Found</h3>
            <p className="text-slate-500 text-sm">Try adjusting your filters or date range.</p>
        </div>
      )}
    </div>

      {imageModalItem && (
        <IncidentImageModal item={imageModalItem} remarkState={remarkState} isMobile={isMobile}
          onClose={() => setImageModalItem(null)}
          onRemarkChange={handleRemarkChange} onRemarkSave={handleRemarkSave} formatDate={formatDate}
        />
      )}
    </div>
  );
});


// --- Components ---

// ---------------------------------------------------------------------------
// Webcam / RTSP stream viewer with bounding-box overlay
// ---------------------------------------------------------------------------
const WebcamStream = forwardRef(({ active, showAI, activeModules }: { active: boolean, showAI: boolean, activeModules: Record<string, boolean> }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    takeSnapshot: () => {
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // If AI is shown, we could draw it on canvas too, but for now just the raw frame
          const dataUrl = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `sitevision-snapshot-${new Date().getTime()}.png`;
          link.href = dataUrl;
          link.click();
        }
      }
    }
  }));

  useEffect(() => {
    let stream: MediaStream | null = null;

    const startWebcam = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing webcam:", err);
        setError("Camera access denied or not available");
      }
    };

    if (active) {
      startWebcam();
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [active]);

  const [detections, setDetections] = useState<{id: number, label: string, time: string}[]>([]);

  useEffect(() => {
    if (!active || !showAI) return;

    const interval = setInterval(() => {
      const activeKeys = Object.keys(activeModules).filter(k => activeModules[k]);
      if (activeKeys.length === 0) return;

      const randomModule = activeKeys[Math.floor(Math.random() * activeKeys.length)];
      const newDetection = {
        id: Date.now(),
        label: randomModule.replace(' Detection', ''),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };

      setDetections(prev => [newDetection, ...prev].slice(0, 5));
    }, 3000);

    return () => clearInterval(interval);
  }, [active, showAI, activeModules]);

  if (error) {
    return (
      <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-500 p-4 text-center">
        <Camera size={48} className="mb-4 opacity-20" />
        <p className="text-sm">{error}</p>
        <p className="text-xs mt-2">Please ensure camera permissions are granted in your browser.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
      
      {showAI && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Real-time Detection Log Overlay */}
          <div className="absolute bottom-4 left-4 z-20 space-y-1">
            {detections.map((det) => (
              <motion.div
                key={det.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded text-[10px] text-white"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="font-mono text-blue-400">[{det.time}]</span>
                <span className="font-bold uppercase tracking-wider">{det.label} DETECTED</span>
              </motion.div>
            ))}
          </div>

          {/* Simulated Bounding Boxes */}
          {activeModules['Helmet Detection'] && (
            <motion.div 
              animate={{ 
                x: [100, 120, 110, 100],
                y: [50, 60, 55, 50]
              }}
              transition={{ duration: 4, repeat: Infinity }}
              className="absolute border-2 border-emerald-500 w-32 h-48 rounded"
            >
              <span className="absolute -top-6 left-0 bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 font-bold uppercase rounded-t">
                Person 98%
              </span>
              <div className="absolute top-2 left-2 w-20 h-1 bg-emerald-500/30 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 w-full" />
              </div>
              <span className="absolute top-4 left-2 text-[8px] text-emerald-500 font-bold uppercase">Helmet: Detected</span>
            </motion.div>
          )}

          {activeModules['Precast Objects'] && (
            <motion.div 
              animate={{ 
                x: [300, 280, 290, 300],
                y: [200, 210, 205, 200]
              }}
              transition={{ duration: 5, repeat: Infinity, delay: 1 }}
              className="absolute border-2 border-blue-500 w-24 h-24 rounded"
            >
              <span className="absolute -top-6 left-0 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 font-bold uppercase rounded-t">
                Object: Tool
              </span>
            </motion.div>
          )}

          {/* Scanning Line */}
          <motion.div 
            animate={{ top: ['0%', '100%', '0%'] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="absolute left-0 right-0 h-px bg-blue-400/50 shadow-[0_0_15px_rgba(59,130,246,0.5)] z-10"
          />
        </div>
      )}

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2 py-1 rounded-full border border-white/10">
          <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold text-white uppercase tracking-wider">Live</span>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Safety heat-map view
// ---------------------------------------------------------------------------
const SafetyMap = () => {
  const zones = [
    { id: 'CCTV1', x: 20, y: 30, status: 'normal', label: 'Main Entrance' },
    { id: 'CCTV2', x: 45, y: 25, status: 'warning', label: 'Crane Area' },
    { id: 'CCTV3', x: 70, y: 40, status: 'normal', label: 'Loading Bay' },
    { id: 'CCTV4', x: 30, y: 65, status: 'normal', label: 'Storage A' },
    { id: 'CCTV5', x: 60, y: 70, status: 'normal', label: 'Excavation' },
    { id: 'CCTV6', x: 85, y: 20, status: 'normal', label: 'Site Office' },
  ];

  return (
    <div className="relative w-full aspect-[21/9] bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
      {/* Grid Background */}
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      
      {/* Site Layout Sketch (Simulated) */}
      <svg className="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 100 100">
        <path d="M10,20 L90,20 L90,80 L10,80 Z" fill="none" stroke="#3b82f6" strokeWidth="0.5" />
        <path d="M40,20 L40,40 L60,40 L60,20" fill="none" stroke="#3b82f6" strokeWidth="0.5" />
        <circle cx="50" cy="30" r="5" fill="none" stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="2 2" />
      </svg>

      {/* Zone Indicators */}
      {zones.map((zone) => (
        <motion.div
          key={zone.id}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute"
          style={{ left: `${zone.x}%`, top: `${zone.y}%` }}
        >
          <div className="relative group cursor-pointer">
            <div className={cn(
              "w-4 h-4 rounded-full border-2 border-white shadow-lg animate-pulse",
              zone.status === 'normal' ? "bg-emerald-500" : "bg-orange-500"
            )} />
            <div className="absolute top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30">
              <div className="bg-black/80 backdrop-blur-md text-white text-[10px] px-2 py-1 rounded border border-white/10">
                <p className="font-bold">{zone.id}</p>
                <p className="text-slate-400">{zone.label}</p>
              </div>
            </div>
          </div>
        </motion.div>
      ))}

      <div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span className="text-[10px] text-white font-medium uppercase tracking-wider">Normal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-orange-500 rounded-full" />
            <span className="text-[10px] text-white font-medium uppercase tracking-wider">Warning</span>
          </div>
        </div>
      </div>

      <div className="absolute top-4 left-4">
        <div className="flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 px-2 py-1 rounded text-[10px] text-blue-400 font-mono uppercase tracking-widest">
          <Map size={12} /> Site Zone Layout v2.4
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// YOLO detection bounding-box overlay for webcam preview
// ---------------------------------------------------------------------------
const BoundingBoxOverlay = ({ detections }: { detections: any[] }) => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {detections.map((det, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute border-2 rounded-sm"
          style={{
            left: `${det.bbox[0]}%`,
            top: `${det.bbox[1]}%`,
            width: `${det.bbox[2]}%`,
            height: `${det.bbox[3]}%`,
            borderColor: det.color,
            backgroundColor: `${det.color}15`
          }}
        >
          <div 
            className="absolute -top-6 left-0 px-2 py-0.5 rounded text-[10px] font-bold text-white whitespace-nowrap"
            style={{ backgroundColor: det.color }}
          >
            {det.label} {(det.confidence * 100).toFixed(0)}%
          </div>
        </motion.div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sidebar navigation item
// ---------------------------------------------------------------------------
const SidebarItem = ({ icon: Icon, label, active, onClick, badge }: { icon: any, label: string, active: boolean, onClick: () => void, badge?: number }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group",
      active 
        ? "bg-blue-50 text-blue-600 font-medium" 
        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
    )}
  >
    <Icon size={20} className={cn(active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600")} />
    <span className="text-sm flex-1 text-left">{label}</span>
    {badge !== undefined && (
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{badge}</span>
    )}
    {active && !badge && <motion.div layoutId="active-pill" className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />}
  </button>
);

// ---------------------------------------------------------------------------
// Stat card for dashboard KPI display
// ---------------------------------------------------------------------------
const StatCard = ({ label, value, subtext, icon: Icon, trend, trendType = 'up' }: { label: string, value: string | number, subtext?: string, icon: any, trend?: string, trendType?: 'up' | 'down' }) => (
  <motion.div 
    whileHover={{ y: -4 }}
    className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all group"
  >
    <div className="flex justify-between items-start mb-4">
      <div className="p-3 bg-slate-50 rounded-xl text-slate-600 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
        <Icon size={24} />
      </div>
      {trend && (
        <div className={cn(
          "flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider",
          trendType === 'up' ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
        )}>
          {trendType === 'up' ? <ArrowUp size={10} /> : <AlertTriangle size={10} />}
          {trend}
        </div>
      )}
    </div>
    <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{label}</h3>
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-black text-slate-900 tracking-tight">{value}</span>
      {subtext && <span className="text-[10px] text-slate-400 font-medium">{subtext}</span>}
    </div>
    <div className="mt-4 h-1 w-full bg-slate-50 rounded-full overflow-hidden">
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: '70%' }}
        className="h-full bg-blue-600/20"
      />
    </div>
  </motion.div>
);

// ---------------------------------------------------------------------------
// Camera feed component
// ---------------------------------------------------------------------------
interface CameraFeedProps {
  id: string;
  name: string;
  zone: string;
  project?: string;
  status: string;
  detection: string;
  videoUrl?: string;
  onExpand?: () => void;
}

const CameraFeed: React.FC<CameraFeedProps> = ({ 
  id, 
  name, 
  zone, 
  project,
  status, 
  detection, 
  videoUrl, 
  onExpand 
}) => {
  const [ts, setTs] = useState(Date.now());
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    if (!videoUrl?.startsWith('/api/stream')) return;
    const interval = setInterval(() => {
      if (!document.hidden) setTs(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, [videoUrl]);
  return (
    <div 
      className="bg-white rounded-2xl border border-slate-100 overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-300"
      onClick={onExpand}
    >
      <div className="relative aspect-video bg-slate-900 flex items-center justify-center">
        {videoUrl ? (
          videoUrl.startsWith('/api/stream') ? (
            <>
              {!imgLoaded && !imgError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Activity className="animate-spin text-blue-400" size={32} />
                </div>
              )}
              {imgError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-10">
                  <Video size={40} className="mb-2 opacity-20" />
                  <p className="text-xs">Camera Unavailable</p>
                </div>
              )}
              <img
                src={`${videoUrl}/snapshot?t=${ts}`}
                alt="Live Stream"
                decoding="async"
                className={`w-full h-full object-cover ${imgError || !imgLoaded ? 'hidden' : ''}`}
                onError={() => setImgError(true)}
                onLoad={() => { setImgLoaded(true); setImgError(false); }}
              />
            </>
          ) : (
            <video 
              src={videoUrl} 
              autoPlay 
              loop 
              muted 
              playsInline 
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <Video size={48} className="text-slate-800 opacity-20" />
        )}
        
        <div className="absolute top-3 left-3 z-20">
          <span className={cn(
            "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
            status === 'Normal' ? "bg-emerald-500 text-white" : 
            status === 'Warning' ? "bg-orange-500 text-white" : "bg-blue-500 text-white"
          )}>
            {status}
          </span>
        </div>
        
        
        <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition-opacity z-30">
          <div className="w-full py-1.5 bg-white/20 backdrop-blur-md text-white text-xs font-medium rounded-lg flex items-center justify-center gap-2 pointer-events-none">
            <Maximize2 size={14} /> Click to Expand
          </div>
        </div>
        </div>
        <div className="p-3 border-t border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{name}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">{zone}</p>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{detection}</p>
        </div>
      </div>
  );
};

// ─── Safety Analytics Page with Custom Dashboard ─────────────
type WidgetType = 'incidents-over-time' | 'zone-incidents' | 'top-activities' | 'stats-row' | 'zone-risk-table' | 'project-breakdown';

interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  colSpan: 4 | 6 | 8 | 12;
}

interface SavedDashboard {
  name: string;
  widgets: DashboardWidget[];
}

const AVAILABLE_WIDGETS: { type: WidgetType; label: string; icon: any; description: string }[] = [
  { type: 'stats-row', label: 'KPI Summary', icon: BarChart3, description: 'Total incidents, high risk, today, zones' },
  { type: 'incidents-over-time', label: 'Incidents Over Time', icon: TrendingUp, description: 'Bar chart of incidents grouped by date' },
  { type: 'zone-incidents', label: 'Incidents by Zone', icon: BarChart2, description: 'Bar chart per camera zone' },
  { type: 'top-activities', label: 'Top Unsafe Activities', icon: AlertTriangle, description: 'Horizontal bar of top violations' },
  { type: 'zone-risk-table', label: 'Zone Risk Table', icon: Database, description: 'Ranked table of zones by risk' },
  { type: 'project-breakdown', label: 'Project Breakdown', icon: LayoutGrid, description: 'Incidents grouped by project' },
];

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: '1', type: 'stats-row', title: 'KPI Summary', colSpan: 12 },
  { id: '2', type: 'incidents-over-time', title: 'Incidents Over Time', colSpan: 12 },
  { id: '4', type: 'zone-incidents', title: 'Incidents by Zone', colSpan: 6 },
  { id: '5', type: 'top-activities', title: 'Top Unsafe Activities', colSpan: 6 },
];

// ---------------------------------------------------------------------------
// Safety Analytics page — charts, zone breakdown, trends
// ---------------------------------------------------------------------------
const SafetyAnalyticsPage = React.memo(() => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timePeriod, setTimePeriod] = useState<'week' | 'month' | 'year'>('week');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(DEFAULT_WIDGETS);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [savedDashboards, setSavedDashboards] = useState<SavedDashboard[]>([
    { name: 'Executive Overview', widgets: DEFAULT_WIDGETS },
  ]);
  const [activeDashboard, setActiveDashboard] = useState('Executive Overview');
  const [newDashboardName, setNewDashboardName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [editingWidgetTitle, setEditingWidgetTitle] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');

  const [selectedZone, setSelectedZone] = useState('All');
  const [selectedProject, setSelectedProject] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [timeSeriesData, setTimeSeriesData] = useState<any[]>([]);
  const [projectData, setProjectData] = useState<any[]>([]);
  const [allZones, setAllZones] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [highRiskCount, setHighRiskCount] = useState(0);
  const now = new Date();

  // Fetch all zones and projects on mount
  useEffect(() => {
    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const [statsRes, projRes] = await Promise.all([
          fetch('/api/safety-model/stats'),
          fetch('/api/safety-model/by-project')
        ]);
        const statsData = await statsRes.json();
        if (!cancelled) {
          setAllZones((statsData.by_zone || []).map((z: any) => z.zone).filter(Boolean));
          setAllProjects((await projRes.json()).map((p: any) => p.project).filter(Boolean));
        }
      } catch (e) { console.error('Failed to fetch metadata', e); }
    };
    fetchMeta();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedZone !== 'All') params.append('camera_zone', selectedZone);
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);

        const timeSeriesParams = new URLSearchParams(params);
        timeSeriesParams.append('period', timePeriod);

        const [statsRes, tsRes, projRes, hrRes] = await Promise.all([
          fetch(`/api/safety-model/stats?${params.toString()}`),
          fetch(`/api/safety-model/time-series?${timeSeriesParams.toString()}`),
          fetch(`/api/safety-model/by-project?${params.toString()}`),
          fetch(`/api/safety-model/high-risk-count?${params.toString()}`)
        ]);

        if (!cancelled) {
          setStats(await statsRes.json());
          setTimeSeriesData(await tsRes.json());
          setProjectData(await projRes.json());
          setHighRiskCount((await hrRes.json()).count);
        }
      } catch (e) { console.error('Failed to fetch safety analytics', e); }
      finally { if (!cancelled) setLoading(false); }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [selectedZone, selectedProject, startDate, endDate, timePeriod]);

  const zoneData = useMemo(() => (stats?.by_zone || []).filter((z: any) => selectedZone === 'All' || z.zone === selectedZone), [stats, selectedZone]);
  const todayCount = useMemo(() => timeSeriesData.find((d: any) => d.date === new Date().toISOString().split('T')[0])?.count || 0, [timeSeriesData]);
  const zoneCount = zoneData.length;
  const kpiCards = useMemo(() => [
    { label: 'Total Events', value: stats?.total_incidents || 0, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100', icon: AlertTriangle },
    { label: 'High Risk', value: highRiskCount, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100', icon: ShieldCheck },
    { label: 'Today', value: todayCount, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', icon: Clock },
    { label: 'Active Zones', value: zoneCount, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: Map },
  ], [stats?.total_incidents, highRiskCount, todayCount, zoneCount]);

  if (loading) return <div className="flex items-center justify-center h-[60vh]"><Activity className="animate-spin text-blue-600" size={48} /></div>;

  const activityData = stats?.by_activity || [];
  const total = stats?.total_incidents || 0;
  const highRisk = highRiskCount;
  const byDateData = timeSeriesData;
  const uniqueZones = allZones;
  const uniqueProjects = allProjects;

  const renderWidget = (widget: DashboardWidget) => {
    switch (widget.type) {
      case 'stats-row':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpiCards.map(({ label, value, color, bg, border, icon: Icon }) => (
              <div key={label} className={cn("p-5 rounded-2xl border", bg, border)}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</p>
                  <Icon className={color} size={16} />
                </div>
                <p className={cn("text-3xl font-black", color)}>{value}</p>
              </div>
            ))}
          </div>
        );
      case 'incidents-over-time':
        return (
          <div>
            <div className="flex gap-2 mb-4">
              {(['week', 'month', 'year'] as const).map(period => (
                <button
                  key={period}
                  onClick={() => setTimePeriod(period)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full transition-all",
                    timePeriod === period
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {period.charAt(0).toUpperCase() + period.slice(1)}
                </button>
              ))}
            </div>
            <div className="h-[200px] sm:h-[240px]">
              <Suspense fallback={<div className="skeleton w-full h-full" />}>
                <BarChartWidget data={byDateData} xKey="date" barKey="count" fill="#3b82f6" />
              </Suspense>
            </div>
          </div>
        );
      case 'zone-incidents':
        return (
          <div className="h-[220px] sm:h-[280px]">
            <Suspense fallback={<div className="skeleton w-full h-full" />}>
              <BarChartWidget data={zoneData} xKey="zone" barKey="count" fill="#6366f1" />
            </Suspense>
          </div>
        );
      case 'top-activities':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                {activityData.length} unique activities
              </span>
            </div>
            <div className="space-y-3 max-h-[240px] overflow-y-auto pr-2">
              {activityData.slice(0, 10).map((item: any, idx: number) => {
                const getBarColor = (index: number) => {
                  const activity = item.activity.toLowerCase();
                  if (activity.includes('helmet') || activity.includes('hard hat') || activity.includes('head')) return 'bg-orange-500';
                  if (activity.includes('vest') || activity.includes('reflective') || activity.includes('jacket')) return 'bg-blue-500';
                  if (activity.includes('boot') || activity.includes('footwear') || activity.includes('shoe')) return 'bg-amber-500';
                  if (activity.includes('lighting') || activity.includes('visibility') || activity.includes('dark')) return 'bg-yellow-500';
                  if (activity.includes('debris') || activity.includes('clutter') || activity.includes('obstruction')) return 'bg-rose-500';
                  if (activity.includes('harness') || activity.includes('elevation') || activity.includes('height')) return 'bg-purple-500';
                  if (activity.includes('signage') || activity.includes('sign') || activity.includes('marker')) return 'bg-cyan-500';
                  const colors = ['bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-cyan-500', 'bg-indigo-500'];
                  return colors[index % colors.length];
                };
                const maxCount = activityData[0]?.count || 1;
                const percentage = (item.count / maxCount) * 100;
                
                return (
                  <div key={item.activity} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 truncate flex-1 mr-2" title={formatActivity(item.activity)}>
                        <span className="text-slate-400 mr-1.5">{idx + 1}.</span>
                        {formatActivity(item.activity)}
                      </span>
                      <span className="font-bold text-slate-900">{item.count}</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${getBarColor(idx)} transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {activityData.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <AlertTriangle size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-xs">No activities found</p>
              </div>
            )}
          </div>
        );
      case 'project-breakdown':
        return (
          <div className="h-[220px] sm:h-[280px]">
            <Suspense fallback={<div className="skeleton w-full h-full" />}>
              <BarChartWidget data={projectData} xKey="project" barKey="count" fill="#10b981" />
            </Suspense>
          </div>
        );
      case 'zone-risk-table':
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Zone</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Incidents</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Share</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Risk Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...zoneData].sort((a: any, b: any) => b.count - a.count).map((z: any) => {
                  const pct = total ? Math.round((z.count / total) * 100) : 0;
                  const risk = z.count > 10 ? 'High' : z.count > 4 ? 'Medium' : 'Low';
                  return (
                    <tr key={z.zone} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium text-slate-900">{z.zone}</td>
                      <td className="px-4 py-2.5 text-sm font-bold text-slate-900">{z.count}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[100px]">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn("px-2 py-1 rounded-md text-xs font-bold uppercase",
                          risk === 'High' ? "bg-rose-100 text-rose-600" : risk === 'Medium' ? "bg-orange-100 text-orange-600" : "bg-emerald-100 text-emerald-600")}>
                          {risk}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      default: return null;
    }
  };

  const addWidget = (type: WidgetType) => {
    const meta = AVAILABLE_WIDGETS.find(w => w.type === type);
    if (!meta) return;
    const newWidget: DashboardWidget = {
      id: Date.now().toString(), type, title: meta.label,
      colSpan: type === 'stats-row' || type === 'zone-risk-table' ? 12 : type === 'incidents-over-time' ? 8 : 6,
    };
    setWidgets(prev => [...prev, newWidget]);
    setShowWidgetPicker(false);
  };

  const removeWidget = (id: string) => setWidgets(prev => prev.filter(w => w.id !== id));

  const changeColSpan = (id: string, colSpan: 4 | 6 | 8 | 12) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, colSpan } : w));
  };

  const saveDashboard = () => {
    const name = newDashboardName.trim() || activeDashboard;
    const existing = savedDashboards.find(d => d.name === name);
    if (existing) {
      setSavedDashboards(prev => prev.map(d => d.name === name ? { ...d, widgets } : d));
    } else {
      setSavedDashboards(prev => [...prev, { name, widgets: [...widgets] }]);
      setActiveDashboard(name);
    }
    setNewDashboardName('');
    setShowSaveDialog(false);
  };

  const loadDashboard = (name: string) => {
    const dash = savedDashboards.find(d => d.name === name);
    if (dash) { setWidgets([...dash.widgets]); setActiveDashboard(name); }
  };

  const startEditTitle = (widget: DashboardWidget) => {
    setEditingWidgetTitle(widget.id);
    setEditTitleValue(widget.title);
  };

  const saveWidgetTitle = (id: string) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, title: editTitleValue } : w));
    setEditingWidgetTitle(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Safety Analytics</h1>
          <p className="text-slate-500 text-sm">Executive & manager view of safety performance.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
            <option value="All">All Zones</option>
            {uniqueZones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
            <option value="All">All Projects</option>
            {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium hidden sm:inline">From:</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium hidden sm:inline">To:</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none" />
          </div>
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); }}
              className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-200 transition-colors">
              Clear
            </button>
          )}
          <button onClick={() => setIsCustomMode(!isCustomMode)}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
              isCustomMode ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}>
            <LayoutGrid size={16} /> {isCustomMode ? 'Exit' : 'Customize'}
          </button>
          <button onClick={() => setSummaryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 rounded-lg text-sm font-medium text-white hover:bg-slate-800">
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isCustomMode && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-sm font-bold text-blue-900">Dashboard Edit Mode</span>
                <span className="text-xs text-blue-600 ml-1">Add, remove, or resize widgets to build your view.</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowWidgetPicker(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">
                  <Plus size={14} /> Add Widget
                </button>
                <button onClick={() => setShowSaveDialog(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white border border-blue-200 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-50">
                  <Save size={14} /> Save Dashboard
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-12 gap-5">
        {widgets.map(widget => (
          <motion.div key={widget.id} layout
            className={cn("bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden",
              widget.colSpan === 12 ? "col-span-12" : widget.colSpan === 8 ? "col-span-12 lg:col-span-8" :
              widget.colSpan === 6 ? "col-span-12 lg:col-span-6" : "col-span-12 lg:col-span-4")}>
            <div className={cn("px-5 py-4 border-b border-slate-100 flex items-center justify-between", isCustomMode && "bg-slate-50")}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isCustomMode && <GripVertical size={16} className="text-slate-400 shrink-0 cursor-grab" />}
                {editingWidgetTitle === widget.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <SpeechInput value={editTitleValue} onChange={(e) => setEditTitleValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveWidgetTitle(widget.id)}
                      className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500" autoFocus />
                    <button onClick={() => saveWidgetTitle(widget.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-bold">✓</button>
                    <button onClick={() => setEditingWidgetTitle(null)} className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-xs">✕</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 truncate">{widget.title}</h3>
                  </div>
                )}
              </div>
              {isCustomMode && (
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <div className="flex items-center gap-0.5 mr-2">
                    {([4, 6, 8, 12] as const).map(s => (
                      <button key={s} onClick={() => changeColSpan(widget.id, s)}
                        className={cn("w-6 h-6 rounded text-[10px] font-bold transition-all",
                          widget.colSpan === s ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600 hover:bg-slate-300")}>
                        {s === 12 ? 'F' : s === 8 ? 'L' : s === 6 ? 'M' : 'S'}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => startEditTitle(widget)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => removeWidget(widget.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all">
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
            <div className="p-5">{renderWidget(widget)}</div>
          </motion.div>
        ))}
      </div>

      {showWidgetPicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Add a Widget</h3>
              <button onClick={() => setShowWidgetPicker(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              {AVAILABLE_WIDGETS.map(w => {
                const Icon = w.icon;
                const alreadyAdded = widgets.some(ww => ww.type === w.type);
                return (
                  <button key={w.type} onClick={() => !alreadyAdded && addWidget(w.type)} disabled={alreadyAdded}
                    className={cn("flex items-start gap-3 p-4 rounded-xl border text-left transition-all",
                      alreadyAdded ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed" :
                      "border-slate-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer")}>
                    <div className={cn("p-2 rounded-lg shrink-0", alreadyAdded ? "bg-slate-100 text-slate-400" : "bg-blue-100 text-blue-600")}><Icon size={18} /></div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{w.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{w.description}</p>
                      {alreadyAdded && <span className="text-[10px] text-emerald-600 font-bold uppercase mt-1 block">Already added</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {showSaveDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Save Dashboard</h3>
              <button onClick={() => setShowSaveDialog(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Dashboard Name</label>
                <SpeechInput value={newDashboardName} onChange={(e) => setNewDashboardName(e.target.value)}
                  placeholder={activeDashboard}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                <p className="text-xs text-slate-400 mt-1">Leave blank to overwrite "{activeDashboard}"</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Saved Dashboards</p>
                <div className="space-y-1">
                  {savedDashboards.map(d => (
                    <div key={d.name} className="flex items-center justify-between py-1">
                      <span className={cn("text-sm", d.name === activeDashboard ? "font-bold text-blue-600" : "text-slate-700")}>{d.name}</span>
                      {d.name !== 'Executive Overview' && (
                        <button onClick={() => setSavedDashboards(prev => prev.filter(dd => dd.name !== d.name))}
                          className="p-1 text-slate-400 hover:text-rose-500 rounded"><Trash2 size={12} /></button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowSaveDialog(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
              <button onClick={saveDashboard} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 flex items-center gap-2">
                <Save size={14} /> Save
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {summaryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">Safety Analytics Summary</h3>
              <button onClick={() => setSummaryOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="grid grid-cols-4 gap-3">
                {kpiCards.map(({ label, value, color, bg, border }) => (
                  <div key={label} className={cn("p-4 rounded-xl border text-center", bg, border)}>
                    <p className={cn("text-[10px] font-bold uppercase tracking-wider", color)}>{label}</p>
                    <p className={cn("text-3xl font-black mt-1", color)}>{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 mb-3">Top Activities</h4>
                <div className="space-y-2">
                  {activityData.slice(0, 5).map((a: any) => (
                    <div key={a.activity} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <span className="text-sm text-slate-700 font-medium">{formatActivity(a.activity) || 'Unknown'}</span>
                      <span className="text-sm font-bold text-slate-900">{a.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              {projectData.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-slate-900 mb-3">Incidents by Project</h4>
                  <div className="space-y-2">
                    {projectData.slice(0, 5).map((p: any) => (
                      <div key={p.project} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <span className="text-sm text-slate-700 font-medium">{p.project}</span>
                        <span className="text-sm font-bold text-slate-900">{p.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100">
                <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Zap size={14} /> AI Recommendations
                </h4>
                <ul className="space-y-2">
                  {['Prioritize safety interventions in zones with High Risk classification.',
                    'Review top unsafe activities and reinforce training for those specific behaviors.',
                    'Schedule targeted audits for camera zones with the highest incident counts.'].map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-blue-800">
                      <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</div>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setSummaryOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Close</button>
              <button onClick={() => {
                const txt = `Safety Analytics Summary\nGenerated: ${new Date().toLocaleString()}\n\nTotal: ${total}\nHigh Risk: ${highRisk}\nToday: ${todayCount}\nZones: ${zoneCount}\n\nTop Activities:\n${activityData.slice(0, 5).map((a: any) => `- ${a.activity}: ${a.count}`).join('\n')}\n\nBy Project:\n${projectData.slice(0, 5).map((p: any) => `- ${p.project}: ${p.count}`).join('\n')}`.trim();
                const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
                a.download = `Safety_Analytics_${new Date().toISOString().split('T')[0]}.txt`; a.click();
              }} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 flex items-center gap-2">
                <Download size={16} /> Download
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
});

// --- Supervision Page Component ---
// ---------------------------------------------------------------------------
// Supervision page — grid of live camera feeds + overlay
// ---------------------------------------------------------------------------
const SupervisionPage = React.memo(({
  setSelectedCamera,
  cameras,
  camerasLoading,
}: {
  setSelectedCamera: (cam: any) => void;
  cameras: any[];
  camerasLoading: boolean;
}) => {
  // Group cameras by project and zone
  const camerasByProject = cameras.reduce((acc: Record<string, any[]>, cam: any) => {
    const project = cam.project || 'Unassigned';
    if (!acc[project]) acc[project] = [];
    acc[project].push(cam);
    return acc;
  }, {});

  const camerasByZone = cameras.reduce((acc: Record<string, any[]>, cam: any) => {
    const zone = cam.zone || 'Unassigned';
    if (!acc[zone]) acc[zone] = [];
    acc[zone].push(cam);
    return acc;
  }, {});

  const projects = Object.keys(camerasByProject).sort();
  const zones = Object.keys(camerasByZone).sort();
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedZone, setSelectedZone] = useState<string>('all');

  // Filter cameras by selected project and zone
  const filteredCameras = cameras.filter((cam: any) => {
    const projectMatch = selectedProject === 'all' || cam.project === selectedProject;
    const zoneMatch = selectedZone === 'all' || cam.zone === selectedZone;
    return projectMatch && zoneMatch;
  });

  // Group filtered cameras by zone for display
  const filteredByZone = filteredCameras.reduce((acc: Record<string, any[]>, cam: any) => {
    const zone = cam.zone || 'Unassigned';
    if (!acc[zone]) acc[zone] = [];
    acc[zone].push(cam);
    return acc;
  }, {});

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Live Camera Grid</h1>
          <p className="text-slate-500 text-sm">Real-time supervision of all active site zones.</p>
        </div>
        <div className="flex gap-3">
          <select
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            onChange={(e) => setSelectedProject(e.target.value)}
            value={selectedProject}
          >
            <option value="all">Projects</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            onChange={(e) => setSelectedZone(e.target.value)}
            value={selectedZone}
          >
            <option value="all">CameraZone</option>
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      </div>

      {camerasLoading ? (
        <div className="flex items-center justify-center h-[60vh]">
          <Activity className="animate-spin text-blue-600" size={48} />
        </div>
      ) : (
        <div className="space-y-8">
          {Object.keys(filteredByZone).map(zone => (
            <div key={zone} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-blue-600 rounded-full" />
                <h2 className="text-lg font-bold text-slate-900">{zone}</h2>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  {filteredByZone[zone].length} cameras
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto">
                {filteredByZone[zone].map((cam: any) => (
                  <CameraFeed
                    key={cam.id}
                    id={cam.id}
                    name={cam.name}
                    zone={cam.zone}
                    project={cam.project}
                    status="Normal"
                    detection={`Live RTSP Feed${cam.location ? ' - ' + cam.location : ''}`}
                    videoUrl={`/api/stream/${cam.id}`}
                    onExpand={() => setSelectedCamera({
                      id: cam.id,
                      name: cam.name,
                      zone: cam.zone,
                      project: cam.project,
                      type: 'static',
                      videoUrl: `/api/stream/${cam.id}`
                    })}
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredCameras.length === 0 && (
            <div className="text-center py-20 text-slate-400">
              <Camera size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">No cameras found for selected filters</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Dashboard camera card
// ---------------------------------------------------------------------------
const DashCameraCard = ({ cam, snapshotTs, onSelect }: { cam: any; snapshotTs: number; onSelect: () => void }) => {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  return (
    <div className="relative group cursor-pointer" onClick={onSelect}>
      <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center">
        {!imgLoaded && !imgError && (
          <Activity className="animate-spin text-blue-400" size={24} />
        )}
        {imgError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-10">
            <Video size={32} className="opacity-20" />
          </div>
        )}
        <img src={`/api/stream/${cam.id}/snapshot?t=${snapshotTs}`} alt="Live" decoding="async"
          className={`w-full h-full object-cover ${imgError || !imgLoaded ? 'hidden' : ''}`}
          onError={() => setImgError(true)}
          onLoad={() => { setImgLoaded(true); setImgError(false); }}
        />
        <div className="absolute top-2 left-2 flex gap-2 z-20">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500 text-white">LIVE</span>
          {cam.project && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500 text-white">{cam.project}</span>
          )}
        </div>
        <div className="absolute bottom-2 left-2 right-2 p-2 bg-black/60 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-white text-xs font-medium truncate">{cam.name}</p>
          <p className="text-slate-300 text-[10px]">{cam.zone} · {cam.project}</p>
        </div>
      </div>
    </div>
  );
};

// ─── Status Helpers ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// UAUC status badge config + component
// ---------------------------------------------------------------------------
const UAUC_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  OPEN: { label: 'Open', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  CLOSED: { label: 'Closed', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ACCEPTED: { label: 'Accepted', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Rejected', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  REWORK_REQUIRED: { label: 'Rework Required', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  OVERDUE: { label: 'Open (Overdue)', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

function UaucStatusBadge({ status }: { status: string }) {
  const cfg = UAUC_STATUS_CONFIG[status] || UAUC_STATUS_CONFIG.OPEN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Site Engineer Page ────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// My UAUCs (Task List) page
// ---------------------------------------------------------------------------
const MyUAUCsPage = React.memo(function MyUAUCsPage({ currentEngineer, onViewDetail, isMobile, submissions = [], userRole = '' }: { currentEngineer: string; onViewDetail: (id: number) => void; isMobile?: boolean; submissions?: any[]; userRole?: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({ open: 0, closed_this_month: 0, awaiting_approval: 0, rework_required: 0, overdue: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 15;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => { setPage(1); }, [statusFilter, debouncedSearch]);

  const fetchData = async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (userRole === 'super_admin') {
        params.append('role', 'super_admin');
      } else if (currentEngineer) {
        params.append('engineer', currentEngineer);
      }
      if (statusFilter) params.append('status', statusFilter);
      if (debouncedSearch) params.append('search', debouncedSearch);
      params.append('skip', String((p - 1) * limit));
      params.append('limit', String(limit));

      const data = await cachedFetch(`/api/uaucs/my?${params.toString()}`, { ttl: 15000 });
      const todayStr = new Date().toISOString().split('T')[0];
      const sorted = (data.items || []).sort((a: any, b: any) => {
        const pri = (it: any): number => {
          const s = it.status;
          if (s === 'ACCEPTED' || s === 'CLOSED') return 4;
          if (s === 'AWAITING_APPROVAL') return 3;
          if (s === 'OPEN' && it.target_date && it.target_date < todayStr) return 0;
          if (s === 'REWORK_REQUIRED' || s === 'REJECTED') return 1;
          if (s === 'OPEN') return 2;
          return 5;
        };
        const pa = pri(a), pb = pri(b);
        if (pa !== pb) return pa - pb;
        const da = a.target_date ? new Date(a.target_date).getTime() : Infinity;
        const db = b.target_date ? new Date(b.target_date).getTime() : Infinity;
        return da - db;
      });
      setItems(sorted);
      setTotal(data.total || 0);
      setSummary(data.summary || { open: 0, closed_this_month: 0, awaiting_approval: 0, rework_required: 0, overdue: 0 });
      setPage(p);
    } catch (err: any) {
      setError(err.message || 'Failed to load UAUCs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(page); }, [page, statusFilter, debouncedSearch, currentEngineer]);

  const totalPages = Math.ceil(total / limit);
  const today = new Date().toISOString().split('T')[0];

  const tabs = [
    { key: '', label: 'All' },
    { key: 'OPEN', label: 'Open' },
    { key: 'AWAITING_APPROVAL', label: 'Awaiting Approval' },
    { key: 'REWORK_REQUIRED', label: 'Rework Required' },
    { key: 'ACCEPTED', label: 'Accepted' },
    { key: 'OVERDUE', label: 'Overdue' },
  ];

  const statusMap: Record<string, string> = {
    'Rework Required': 'REWORK_REQUIRED',
    'Awaiting Approval': 'AWAITING_APPROVAL',
    'Approved': 'ACCEPTED',
    'Open': 'OPEN',
  };
  const mergedItems = useMemo(() => {
    const result = [...items];
    for (const sub of submissions) {
      const idx = result.findIndex(m => String(m.id) === String(sub.id));
      if (idx >= 0) {
        const mappedStatus = statusMap[sub.status] || sub.status;
        result[idx] = { ...result[idx], status: mappedStatus };
      }
    }
    return result;
  }, [items, submissions]);

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-blue-700 mb-2">My Tasks <ChevronRight size={14} className="inline mx-1" /> Assigned to Me</div>
          <h2 className="text-2xl font-bold text-slate-900">Site Engineer</h2>
          <p className="text-slate-500">Unsafe Acts & Unsafe Conditions assigned to you</p>
        </div>
        <button onClick={() => fetchData(page)} disabled={loading}
          className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
          <Activity size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-xl border border-orange-100 bg-orange-50 p-5">
          <p className="text-3xl font-bold text-orange-600">{summary.open}</p>
          <p className="text-sm font-bold text-slate-700">Open UAUCs</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
          <p className="text-3xl font-bold text-emerald-600">{summary.closed_this_month}</p>
          <p className="text-sm font-bold text-slate-700">Closed This Month</p>
        </div>
        <div className="rounded-xl border border-purple-100 bg-purple-50 p-5">
          <p className="text-3xl font-bold text-purple-600">{summary.awaiting_approval}</p>
          <p className="text-sm font-bold text-slate-700">Awaiting Approval</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-5">
          <p className="text-3xl font-bold text-amber-600">{summary.rework_required}</p>
          <p className="text-sm font-bold text-slate-700">Rework Required</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-5">
          <p className="text-3xl font-bold text-red-600">{summary.overdue}</p>
          <p className="text-sm font-bold text-slate-700">Overdue</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative max-w-xs">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-10 px-4 pr-10 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer">
              {tabs.map((tab) => (
                <option key={tab.key} value={tab.key}>{tab.label}</option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-md ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <SpeechInput placeholder="Search by UAUC ID, location, issue..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Activity className="animate-spin text-blue-600" size={36} />
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <AlertTriangle size={40} className="mx-auto text-red-400 mb-3" />
            <p className="text-sm font-bold text-red-600">{error}</p>
            <button onClick={() => fetchData(page)} className="mt-3 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
              Retry
            </button>
          </div>
        ) : mergedItems.length === 0 ? (
          <div className="py-12 text-center">
            <FileText size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-1">No UAUCs Found</h3>
            <p className="text-sm text-slate-500">No compliance findings assigned to you yet.</p>
          </div>
        ) : isMobile ? (
          <div className="divide-y divide-slate-100">
            {mergedItems.map((item) => {
              const computedStatus = (() => {
                if (item.status === 'ACCEPTED') return 'ACCEPTED';
                if (item.status === 'REWORK_REQUIRED') return 'REWORK_REQUIRED';
                if (item.status === 'CLOSED') return 'CLOSED';
                if (item.status === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
                if (item.target_date && item.target_date < today) return 'OVERDUE';
                return 'OPEN';
              })();
              return (
                <div key={item.id} className="p-4 space-y-3 hover:bg-slate-50/50 transition-colors" onClick={() => onViewDetail(item.id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                        {item.has_image ? (
                          <img src={item.image_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <ImageIcon size={16} className="text-slate-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{item.audit_id}</p>
                        <p className="text-xs text-slate-500">{item.location || item.project || '--'}</p>
                      </div>
                    </div>
                    <UaucStatusBadge status={computedStatus} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Issues</span>
                      <p className="font-bold text-slate-900">{item.issues_count}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Target Date</span>
                      <p className={cn("font-semibold",
                        item.target_date && item.target_date < today && item.status !== 'CLOSED' ? 'text-red-600' : 'text-slate-700')}>
                        {item.target_date ? new Date(item.target_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    {computedStatus === 'REWORK_REQUIRED' ? (
                      <span className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-bold">Continue Closure</span>
                    ) : (
                      <span className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-bold">View</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold">Image</th>
                    <th className="text-left px-4 py-3 font-bold">UAUC ID</th>
                    <th className="text-left px-4 py-3 font-bold">Location</th>
                    <th className="text-left px-4 py-3 font-bold">Issues</th>
                    <th className="text-left px-4 py-3 font-bold">Target Date</th>
                    <th className="text-left px-4 py-3 font-bold">Status</th>
                    <th className="text-right px-4 py-3 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mergedItems.map((item) => {
                    const computedStatus = (() => {
                      if (item.status === 'ACCEPTED') return 'ACCEPTED';
                      if (item.status === 'REWORK_REQUIRED') return 'REWORK_REQUIRED';
                      if (item.status === 'CLOSED') return 'CLOSED';
                      if (item.status === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
                      if (item.target_date && item.target_date < today) return 'OVERDUE';
                      return 'OPEN';
                    })();
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                            {item.has_image ? (
                              <img src={item.image_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <ImageIcon size={16} className="text-slate-400" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-slate-900">{item.audit_id}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-700">{item.location || item.project || '--'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-slate-900">{item.issues_count}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("text-sm font-semibold",
                            item.target_date && item.target_date < today && item.status !== 'CLOSED'
                              ? 'text-red-600 font-bold' : 'text-slate-700')}>
                            {item.target_date ? new Date(item.target_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <UaucStatusBadge status={computedStatus} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end">
                            {computedStatus === 'REWORK_REQUIRED' ? (
                              <button onClick={() => onViewDetail(item.id)}
                                className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-bold hover:bg-amber-600 transition-all">
                                Continue Closure
                              </button>
                            ) : (
                              <button onClick={() => onViewDetail(item.id)}
                                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-bold hover:bg-slate-800 transition-all">
                                View
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <p className="text-xs text-slate-500">
                Showing {total > 0 ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)}` : '0'} of {total} records
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => fetchData(page - 1)} disabled={page <= 1}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50 transition-colors">
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button key={p} onClick={() => fetchData(p)}
                      className={cn("px-3 py-1.5 text-xs rounded-md transition-colors",
                        page === p ? "bg-blue-600 text-white" : "border border-slate-200 hover:bg-slate-50")}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => fetchData(page + 1)} disabled={page >= totalPages}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50 transition-colors">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ─── UAUC Detail Page ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// UAUC Detail page (single task view with observations)
// ---------------------------------------------------------------------------
const UAUCDetailPage = React.memo(function UAUCDetailPage({ uaucId, onBack }: { uaucId: number | null; onBack: () => void }) {
  const [item, setItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uaucId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    cachedFetch(`/api/uaucs/${uaucId}`, { ttl: 30000 })
      .then((data) => { if (!cancelled) setItem(data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load UAUC'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uaucId]);

  if (!uaucId) return null;

  if (loading) {
    return (
      <div className="p-4 space-y-4 page-enter">
        <div className="flex items-center gap-3 mb-2">
          <div className="skeleton w-8 h-8 rounded-full" />
          <div className="skeleton h-5 w-24" />
          <div className="skeleton h-5 w-16 ml-auto rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="skeleton h-[72px] rounded-xl" />
          <div className="skeleton h-[72px] rounded-xl" />
          <div className="skeleton h-[72px] rounded-xl" />
          <div className="skeleton h-[72px] rounded-xl" />
        </div>
        <div className="skeleton h-4 w-32 mt-2" />
        <div className="space-y-2">
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-16 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <AlertTriangle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-sm font-medium text-red-600">{error}</p>
        <button onClick={onBack} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
          Go Back
        </button>
      </div>
    );
  }

  if (!item) return null;

  const today = new Date().toISOString().split('T')[0];
  const computedStatus = (() => {
    if (item.status === 'CLOSED') return 'CLOSED';
    if (item.status === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
    if (item.target_date && item.target_date < today) return 'OVERDUE';
    return 'OPEN';
  })();

  const timeline = [
    { event: 'Created', date: item.observation_date, icon: 'plus', desc: 'UAUC was created' },
    { event: 'Assigned', date: item.observation_date, icon: 'user', desc: `Assigned to ${item.site_engineer || 'Site Engineer'}` },
    { event: 'Comment Added', date: null, icon: 'message', desc: item.breif_description || 'No comments added' },
    item.status === 'AWAITING_APPROVAL' ? { event: 'Submitted', date: null, icon: 'send', desc: 'Submitted for approval' } : null,
    item.status === 'CLOSED' ? { event: 'Approved', date: item.closed_date, icon: 'check', desc: 'UAUC approved and closed' } : null,
    item.status === 'CLOSED' ? { event: 'Closed', date: item.closed_date, icon: 'check-circle', desc: 'All actions completed' } : null,
  ].filter(Boolean);

  const timelineIcons: Record<string, string> = {
    plus: '+', user: '👤', message: '💬', send: '➤', check: '✓', 'check-circle': '✓',
  };

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronLeft size={20} className="text-slate-500" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{item.audit_id}</h1>
              <UaucStatusBadge status={computedStatus} />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {item.observation_date
                ? new Date(item.observation_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                : '--'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Site Information */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Map size={18} className="text-blue-500" /> Site Information
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Project', value: item.project },
                { label: 'Activity', value: item.activity },
                { label: 'Sub Activity', value: item.sub_activity },
                { label: 'Location', value: item.location },
                { label: 'Target Date', value: item.target_date ? new Date(item.target_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--' },
                { label: 'Assigned To', value: item.site_engineer },
              ].map((f) => (
                <div key={f.label} className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{f.label}</p>
                  <p className="text-sm font-bold text-slate-900">{f.value || '--'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Linked Issues */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <AlertTriangle size={18} className="text-orange-500" /> Linked Issues ({item.issues_count})
            </h3>
            <div className="space-y-2">
              {(item.safety_issues || []).length > 0 ? (
                item.safety_issues.map((iss: string, idx: number) => {
                  const risk = item.possible_risks?.[idx];
                  return (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                      <span className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">{iss}</p>
                        {risk && <p className="text-xs text-slate-500 mt-0.5">Risk: {risk}</p>}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-400 italic p-3 bg-slate-50 rounded-xl">No issues recorded</p>
              )}
            </div>
          </div>

          {/* Corrective Actions */}
          {(item.recommendations || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500" /> Corrective Actions
              </h3>
              <div className="space-y-2">
                {item.recommendations.map((rec: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <p className="text-sm text-slate-700">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Images */}
          {item.has_image && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                <ImageIcon size={18} className="text-blue-500" /> Images
              </h3>
              <div className="rounded-xl bg-slate-900 overflow-hidden max-h-96">
                <img src={item.image_url} alt="UAUC" loading="lazy" decoding="async" className="w-full h-full object-contain max-h-96"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Activity Timeline */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Clock size={18} className="text-blue-500" /> Activity Timeline
            </h3>
            <div className="relative">
              <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-200" />
              <div className="space-y-5">
                {timeline.map((t: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-3 relative">
                    <div className="w-7 h-7 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-blue-600 text-xs font-bold shrink-0 z-10 shadow-sm">
                      {timelineIcons[t.event] || idx + 1}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-sm font-bold text-slate-900">{t.event}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
                      {t.date && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ─── EHS Engineer Page ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// My Tasks Init page (initiator review of submissions)
// ---------------------------------------------------------------------------
const MyTasksInitPage = React.memo(function MyTasksInitPage({ submissions = [], onReviewSubmission, onViewDetail, initiatorName = '', userRole = '' }: { submissions?: any[]; onReviewSubmission?: (item: any, list?: any[]) => void; onViewDetail?: (item: any) => void; initiatorName?: string; userRole?: string }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [apiItems, setApiItems] = useState<any[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const rowsPerPage = 15;

  // Fetch from database on mount so data persists across refresh
  useEffect(() => {
    let cancelled = false;
    setApiLoading(true);
    const params = new URLSearchParams();
    if (userRole === 'super_admin') {
      params.append('role', 'super_admin');
    } else if (initiatorName) {
      params.append('initiated_by', initiatorName);
    }
    params.append('limit', '30');
    cachedFetch(`/api/uaucs/my?${params.toString()}`, { ttl: 30000 })
      .then((data) => { if (!cancelled) setApiItems(data.items || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setApiLoading(false); });
    return () => { cancelled = true; };
  }, [initiatorName]);

  const filterTabs = [
    { key: '', label: 'All Status' },
    { key: 'Overdue', label: 'Overdue' },
    { key: 'Open', label: 'Open' },
    { key: 'Awaiting Approval', label: 'Awaiting Approval' },
    { key: 'Rework Required', label: 'Rework Required' },
    { key: 'Approved', label: 'Approved' },
  ];

  const mapApiItem = (item: any) => ({
    id: item.id,
    status: item.status === 'AWAITING_APPROVAL' ? 'Awaiting Approval'
          : item.status === 'ACCEPTED' ? 'Approved'
          : item.status === 'REJECTED' || item.status === 'REWORK_REQUIRED' ? 'Rework Required'
          : item.status === 'OPEN' ? 'Open'
          : item.status === 'CLOSED' ? 'Approved'
          : item.status || 'Open',
    uaucId: item.audit_id || `UAUC-${item.id}`,
    location: item.location || '',
    siteEngineer: item.site_engineer || '',
    initiatedBy: item.initiated_by || '',
    issuesFixed: item.issues_count || 0,
    raisedOn: item.observation_date ? new Date(item.observation_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    submittedOn: item.closure_se_date ? new Date(item.closure_se_date + 'T' + (item.closure_se_time || '00:00')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + (item.closure_se_time || '') : '',
    targetDate: item.target_date ? new Date(item.target_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
    image_url: item.image_url || null,
    safety_issues: item.safety_issues || [],
    after_images: [],
    targetDateRaw: item.target_date || '',
  });

  const priorityOrder: Record<string, number> = {
    'Overdue': 0,
    'Awaiting Approval': 1,
    'Rework Required': 2,
    'Open': 3,
    'Approved': 4,
    'Rejected': 5,
  };
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parseSubDate = (d: string) => {
    if (!d) return null;
    const parts = d.split(',')[0].trim().split(' ');
    if (parts.length < 3) return null;
    return { month: months[parts[1]], year: parseInt(parts[2]) };
  };
  const todayStr = new Date().toISOString().split('T')[0];
  const nowDate = new Date();
  const currentMonth = nowDate.getMonth();
  const currentYear = nowDate.getFullYear();

  const merged = useMemo(() => {
    const result = [...apiItems.map(mapApiItem)];
    for (const sub of submissions) {
      const idx = result.findIndex((m) => m.id === sub.id);
      if (idx >= 0) {
        result[idx] = { ...result[idx], ...sub };
      } else {
        result.push(sub);
      }
    }
    return result;
  }, [apiItems, submissions]);

  const openCount = useMemo(() => merged.filter(s => s.status === 'Open' && !(s.targetDateRaw && s.targetDateRaw < todayStr)).length, [merged, todayStr]);
  const awaitingCount = useMemo(() => merged.filter(s => s.status === 'Awaiting Approval').length, [merged]);
  const approvedThisMonth = useMemo(() => merged.filter(s => {
    if (s.status !== 'Approved') return false;
    const d = parseSubDate(s.submittedOn);
    return d && d.month === currentMonth && d.year === currentYear;
  }).length, [merged, currentMonth, currentYear]);
  const rejectedCount = useMemo(() => merged.filter(s => s.status === 'Rejected').length, [merged]);
  const reworkCount = useMemo(() => merged.filter(s => s.status === 'Rework Required').length, [merged]);
  const overdueCount = useMemo(() => merged.filter(s => s.status === 'Open' && s.targetDateRaw && s.targetDateRaw < todayStr).length, [merged, todayStr]);

  const allRows = useMemo(() => merged.map((s: any) => {
    const baseStatus = s.status || 'Awaiting Approval';
    const isOverdue = baseStatus === 'Open' && s.targetDateRaw && s.targetDateRaw < todayStr;
    return {
      id: s.id,
      status: baseStatus,
      computedStatus: isOverdue ? 'Overdue' : baseStatus,
      uaucId: s.uaucId || '',
      location: s.location || '',
      siteEngineer: s.siteEngineer || '',
      initiatedBy: s.initiatedBy || '',
      issuesFixed: s.issuesFixed || 0,
      raisedOn: s.raisedOn || '',
      submittedOn: s.submittedOn || '',
      targetDate: s.targetDate || '',
      image_url: s.image_url || null,
      safety_issues: s.safety_issues || [],
      after_images: s.after_images || [],
      targetDateRaw: s.targetDateRaw || '',
    };
  }), [merged, todayStr]);

  const sortedRows = useMemo(() => [...allRows].sort((a, b) => {
    const pa = priorityOrder[a.computedStatus] ?? 99;
    const pb = priorityOrder[b.computedStatus] ?? 99;
    if (pa !== pb) return pa - pb;
    const da = a.targetDateRaw ? new Date(a.targetDateRaw).getTime() : Infinity;
    const db = b.targetDateRaw ? new Date(b.targetDateRaw).getTime() : Infinity;
    return da - db;
  }), [allRows]);

  const filteredRows = useMemo(() => sortedRows.filter(r =>
    (statusFilter === '' || r.computedStatus === statusFilter) &&
    (r.uaucId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.siteEngineer.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [sortedRows, statusFilter, searchQuery]);

  const totalPages = Math.ceil(filteredRows.length / rowsPerPage);
  const paginatedRows = useMemo(() => filteredRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage), [filteredRows, currentPage, rowsPerPage]);

  const actionButton = (status: string, row: any) => {
    if (status === 'Awaiting Approval')
      return <button onClick={() => onReviewSubmission?.(row, merged)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-700 transition-colors whitespace-nowrap shadow-sm">Review Submission</button>;
    if (status === 'Rework Required')
      return <button onClick={() => onReviewSubmission?.(row, merged)} className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-[10px] font-bold hover:bg-orange-100 transition-colors whitespace-nowrap">View Rejection Report</button>;
    if (status === 'Approved')
      return <button onClick={() => onReviewSubmission?.(row, merged)} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors whitespace-nowrap">View Closure Report</button>;
    if (status === 'Open' || status === 'Overdue')
      return <button onClick={() => onViewDetail?.(row)} className="px-3 py-1.5 bg-slate-50 text-slate-700 rounded-lg text-[10px] font-bold hover:bg-slate-100 transition-colors whitespace-nowrap">View Details</button>;
    return <button onClick={() => onReviewSubmission?.(row, merged)} className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-[10px] font-bold hover:bg-orange-100 transition-colors whitespace-nowrap">View Rejection Details</button>;
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-blue-700 mb-2">My Tasks <ChevronRight size={14} className="inline mx-1" /> Review Submissions</div>
          <h2 className="text-2xl font-bold text-slate-900">EHS Engineer</h2>
          <p className="text-slate-500">Review and manage raised UAUC submissions from site engineers</p>
        </div>
        <button onClick={() => { setApiLoading(true); const p = new URLSearchParams(); if (userRole === 'super_admin') p.append('role', 'super_admin'); else if (initiatorName) p.append('initiated_by', initiatorName); p.append('limit', '30'); fetch(`/api/uaucs/my?${p.toString()}`).then(r => r.ok ? r.json() : []).then(d => setApiItems(d.items || [])).catch(() => {}).finally(() => setApiLoading(false)); }} disabled={apiLoading}
          className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
          <Activity size={16} className={apiLoading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-xl border border-orange-100 bg-orange-50 p-5">
          <p className="text-3xl font-bold text-orange-600">{openCount}</p>
          <p className="text-sm font-bold text-slate-700">Open UAUCs</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
          <p className="text-3xl font-bold text-emerald-600">{approvedThisMonth}</p>
          <p className="text-sm font-bold text-slate-700">Approved This Month</p>
        </div>
        <div className="rounded-xl border border-purple-100 bg-purple-50 p-5">
          <p className="text-3xl font-bold text-purple-600">{awaitingCount}</p>
          <p className="text-sm font-bold text-slate-700">Awaiting Approval</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-5">
          <p className="text-3xl font-bold text-amber-600">{reworkCount + rejectedCount}</p>
          <p className="text-sm font-bold text-slate-700">Rework Required</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-5">
          <p className="text-3xl font-bold text-red-600">{overdueCount}</p>
          <p className="text-sm font-bold text-slate-700">Overdue</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative max-w-xs">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="w-full h-10 px-4 pr-10 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer">
              {filterTabs.map((tab) => (
                <option key={tab.key} value={tab.key}>{tab.label}</option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-md ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <SpeechInput placeholder="Search by UAUC ID, location, engineer..." value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        {apiLoading ? (
          <div className="flex items-center justify-center py-16">
            <Activity className="animate-spin text-blue-600" size={36} />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center">
            <FileText size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-1">No UAUCs Found</h3>
            <p className="text-sm text-slate-500">No UAUC submissions to review yet.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[950px]">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold">Image</th>
                    <th className="text-left px-4 py-3 font-bold">UAUC ID</th>
                    <th className="text-left px-4 py-3 font-bold">Location</th>
                    <th className="text-left px-4 py-3 font-bold">Issues</th>
                    <th className="text-left px-4 py-3 font-bold">Target Date</th>
                    <th className="text-left px-4 py-3 font-bold">Status</th>
                    <th className="text-left px-4 py-3 font-bold">Site Engineer</th>
                    <th className="text-right px-4 py-3 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedRows.map((row, i) => {
                    const badgeKeys: Record<string, string> = {
                      'Overdue': 'OVERDUE',
                      'Open': 'OPEN',
                      'Awaiting Approval': 'AWAITING_APPROVAL',
                      'Rework Required': 'REWORK_REQUIRED',
                      'Approved': 'ACCEPTED',
                      'Rejected': 'REJECTED',
                    };
                    return (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                            {row.image_url ? (
                              <img src={row.image_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <ImageIcon size={16} className="text-slate-400" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-slate-900">{row.uaucId}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-700">{row.location || '--'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-slate-900">{row.issuesFixed}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("text-sm font-semibold",
                            row.targetDateRaw && row.targetDateRaw < todayStr && row.computedStatus !== 'Approved'
                              ? 'text-red-600 font-bold' : 'text-slate-700')}>
                            {row.targetDate || '--'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <UaucStatusBadge status={badgeKeys[row.computedStatus] || 'OPEN'} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-slate-700">{row.siteEngineer || '--'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {actionButton(row.computedStatus, row)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <p className="text-xs text-slate-500">
                Showing {filteredRows.length > 0 ? `${(currentPage - 1) * rowsPerPage + 1}–${Math.min(currentPage * rowsPerPage, filteredRows.length)}` : '0'} of {filteredRows.length} records
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50 transition-colors">
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button key={p} onClick={() => setCurrentPage(p)}
                      className={cn("px-3 py-1.5 text-xs rounded-md transition-colors",
                        currentPage === p ? "bg-blue-600 text-white" : "border border-slate-200 hover:bg-slate-50")}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50 transition-colors">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ─── Speech to Text (REMOVED) ─────────────────────────────────────────────

// ─── UAUC Approval Page ───────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// UAUC Approval page (EHSO / reviewer decision)
// ---------------------------------------------------------------------------
const UAUCApprovalPage = React.memo(function UAUCApprovalPage({ item, onBack, onDecision, numericId, onDecisionComplete }: { item: any; onBack: () => void; onDecision?: (uaucId: string, status: 'accepted' | 'rejected', comment: string, unresolvedIssues?: string) => void; numericId?: number | null; onDecisionComplete?: (currentId?: number) => void }) {
  const [reviewerComment, setReviewerComment] = useState('');
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(item?.status === 'Approved');
  const [isRejected, setIsRejected] = useState(item?.status === 'Rejected' || item?.status === 'Rework Required');
  const [dbItem, setDbItem] = useState<any>(null);
  const [afterImages, setAfterImages] = useState<string[]>([]);
  const [unresolvedIndices, setUnresolvedIndices] = useState<Set<number>>(new Set());
  const [acceptedIndices, setAcceptedIndices] = useState<Set<number>>(new Set());
  const [rejectedIndices, setRejectedIndices] = useState<Set<number>>(new Set());
  const maxCommentLength = 500;

  useEffect(() => {
    if (!numericId) return;
    let cancelled = false;
    const issuesList = item?.safety_issues || [];
    cachedFetch(`/api/uaucs/${numericId}`, { ttl: 30000 })
      .then(data => {
        if (cancelled) return;
        setDbItem(data);
        const mapped = issuesList.map((_: string) => '');
        if (data.pending_evidence && Object.keys(data.pending_evidence).length > 0) {
          issuesList.forEach((iss: string, i: number) => {
            const imgData = data.pending_evidence[String(i)];
            if (imgData) mapped[i] = typeof imgData === 'string' ? imgData : imgData.image_data || '';
          });
        }
        const isRework = data.status === 'REWORK_REQUIRED';
        const unresolvedList: string[] = (data.unresolved_issues || '')
          .split('; ').filter(Boolean);
        (data.evidence_images || []).forEach((ev: { issue_name: string; after_image_url: string | null }) => {
          const idx = issuesList.indexOf(ev.issue_name);
          if (idx >= 0 && !mapped[idx] && !(isRework && unresolvedList.includes(ev.issue_name)) && ev.after_image_url) mapped[idx] = ev.after_image_url;
        });
        setAfterImages(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [numericId]);

  const issues = item?.safety_issues || [];
  const correctiveActions = [
    'Workers instructed to wear helmets',
    'Missing helmets issued',
    'Area cleaned',
    'Rebar capped',
    'PPE compliance verified',
  ];

  const isReadOnly = isApproved || isRejected;

  const isIssuePreviouslyResolved = (index: number): boolean => {
    if (!dbItem?.unresolved_issues) return false;
    const unresolved = (dbItem.unresolved_issues as string).split('; ').filter(Boolean);
    const issue = (item?.safety_issues || [])[index];
    return !unresolved.includes(issue);
  };

  const isIssueRejected = (index: number): boolean => {
    if (rejectedIndices.size > 0) return rejectedIndices.has(index);
    if (isRejected && dbItem?.unresolved_issues) {
      const unresolved = (dbItem.unresolved_issues as string).split('; ').filter(Boolean);
      const issue = (item?.safety_issues || [])[index];
      return unresolved.includes(issue);
    }
    return false;
  };

  const handleApprove = async () => {
    if (!reviewerComment.trim()) return;
    try {
      await onDecision?.(item?.uaucId, 'accepted', reviewerComment);
      setIsApproved(true);
      setShowApproveConfirm(false);
      onDecisionComplete?.(numericId ?? undefined);
    } catch (err: any) {
      alert(err?.message || 'Approval failed');
    }
  };

  const handleReject = async () => {
    if (!reviewerComment.trim()) return;
    const unresolvedStr = unresolvedIndices.size > 0
      ? [...unresolvedIndices].sort().map(i => issues[i]).join('; ')
      : '';
    try {
      await onDecision?.(item?.uaucId, 'rejected', reviewerComment, unresolvedStr);
      setIsRejected(true);
      setRejectedIndices(new Set(unresolvedIndices));
      setShowRejectConfirm(false);
      onDecisionComplete?.(numericId ?? undefined);
    } catch (err: any) {
      alert(err?.message || 'Rejection failed');
    }
  };

  const hasUnresolved = unresolvedIndices.size > 0;
  const allReviewed = issues.every((_: string, i: number) => isIssuePreviouslyResolved(i) || acceptedIndices.has(i) || unresolvedIndices.has(i));

  const pageTitle = isApproved ? 'View Closure Report' : isRejected ? 'View Rejection Details' : 'UAUC Approval';
  const statusBadgeLabel = isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Awaiting Approval';

  const createdDate = dbItem?.observation_date
    ? new Date(dbItem.observation_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : item?.raisedOn || '—';
  const closureDate = dbItem?.closure_se_date
    ? new Date(dbItem.closure_se_date + 'T' + (dbItem.closure_se_time || '00:00')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const closureSubmitted = !!(dbItem?.closure_se_date || item?.submittedOn);

  const formatDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const formatDateTime = (d: string) => {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    catch { return d; }
  };

  const getAfterLabel = (issue: string): string => {
    const map: Record<string, string> = {
      'helmet': 'Helmet in Use',
      'harness': 'Harness in Use',
      'housekeeping': 'Area Cleaned',
      'rebar': 'Rebar Capped',
      'barricade': 'Barricade Installed',
    };
    const lower = issue.toLowerCase();
    for (const [key, label] of Object.entries(map)) {
      if (lower.includes(key)) return label;
    }
    return 'Issue Fixed';
  };

  const timelineSteps = [
    {
      label: 'UAUC Created',
      detail: createdDate,
      user: item?.initiatedBy || '—',
      completed: true,
      active: false,
    },
    {
      label: 'Assigned to',
      detail: formatDate(item?.targetDate || ''),
      user: item?.siteEngineer || '—',
      completed: true,
      active: false,
    },
    {
      label: 'Closure Submitted',
      detail: closureDate || formatDateTime(item?.submittedOn || ''),
      user: item?.siteEngineer || '—',
      completed: closureSubmitted || isReadOnly,
      active: !closureSubmitted && !isReadOnly,
    },
    {
      label: isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Pending Approval',
      detail: isReadOnly ? formatDate(new Date().toISOString()) : '—',
      user: isReadOnly ? 'You' : '—',
      completed: isReadOnly,
      active: !isReadOnly,
    },
  ];

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button onClick={onBack} className="hover:text-slate-700 transition-colors font-medium">My Tasks</button>
        <ChevronRight size={14} />
        <span className="text-slate-800 font-semibold">UAUC Approval</span>
      </div>

      {/* Read-only Banner */}
      {isReadOnly && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 md:p-4 flex items-center gap-3">
          <Lock size={18} className="text-blue-500 shrink-0" />
          <p className="text-sm font-semibold text-blue-800">
            This UAUC has been <span className="uppercase">{isApproved ? 'Approved' : 'Rejected'}</span>. All fields are read-only.
          </p>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-[32px] font-bold text-slate-900 leading-tight">{pageTitle}</h1>
          <p className="text-sm text-slate-500 mt-1">Review corrective actions taken by Site Engineer and approve or reject closure.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-bold text-slate-700">{item?.uaucId || '—'}</span>
          <span className="px-3 py-1.5 rounded-lg text-sm font-bold bg-orange-100 text-orange-700">{statusBadgeLabel}</span>
        </div>
      </div>

      {/* Summary Information Strip */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Users size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Initiated By</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{item?.initiatedBy || '—'}</p>
              <p className="text-xs text-slate-400 mt-0.5">{formatDate(createdDate.toString())}</p>
            </div>
          </div>
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><HardHat size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Site Engineer</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{item?.siteEngineer || '—'}</p>
              <p className="text-xs text-slate-400 mt-0.5">{item?.submittedOn || '—'}</p>
            </div>
          </div>
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Flag size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Target Date</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{item?.targetDate || formatDate(dbItem?.target_date || '')}</p>
            </div>
          </div>
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Map size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Location</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{item?.location || dbItem?.location || '—'}</p>
            </div>
          </div>
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><AlertTriangle size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Issues</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">{issues.length}</p>
              <button className="text-xs text-blue-600 font-medium hover:text-blue-700 mt-0.5">View Issue List</button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
        {/* LEFT COLUMN */}
        <div className="w-full lg:w-[58%] space-y-4 md:space-y-6">
          {/* Issue Resolution Review */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">1. Issue Resolution Review</h3>
            <p className="text-sm text-slate-500 mb-4">Review each issue before and after corrective action.</p>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider w-8">#</th>
                  <th className="text-left pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Safety Issue</th>
                  <th className="text-center pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Before</th>
                  <th className="text-center pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">After</th>
                  <th className="text-center pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issues.length > 0 ? issues.map((issue: string, i: number) => (
                  <tr key={i}>
                    <td className="py-4 align-top">
                      <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold mx-auto">{i + 1}</span>
                    </td>
                    <td className="py-4 pr-4">
                      <p className="text-sm font-medium text-slate-900">{issue}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{dbItem?.possible_risks?.[i] || '—'}</p>
                    </td>
                    <td className="py-4 text-center">
                      <div className="relative rounded-lg bg-slate-100 w-16 sm:w-20 h-[58px] sm:h-[72px] overflow-hidden border border-slate-200 inline-block group">
                        {item?.image_url ? (
                          <>
                            <img src={item.image_url} alt="Before" loading="lazy" decoding="async" className="w-full h-full object-cover cursor-pointer"
                              onClick={() => setImagePreviewUrl(item.image_url)}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center cursor-pointer" onClick={() => setImagePreviewUrl(item.image_url)}>
                              <Eye size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-center h-full text-[10px] text-slate-400">No img</div>
                        )}
                        <span className="absolute top-1 left-1 px-1 py-0.5 bg-red-500 text-white text-[8px] font-bold rounded leading-none">Before</span>
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <div className="relative rounded-lg bg-green-50 w-16 sm:w-20 h-[58px] sm:h-[72px] overflow-hidden border border-green-200 inline-block group">
                        {afterImages[i] ? (
                          <>
                            <img src={afterImages[i]} alt="After" loading="lazy" decoding="async" className="w-full h-full object-cover cursor-pointer"
                              onClick={() => setImagePreviewUrl(afterImages[i])} />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center cursor-pointer" onClick={() => setImagePreviewUrl(afterImages[i])}>
                              <Eye size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                        <span className="absolute top-1 left-1 px-1 py-0.5 bg-green-600 text-white text-[8px] font-bold rounded leading-none">After</span>
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      {isReadOnly ? (
                        isIssueRejected(i) ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700">
                            <X size={12} />Rework
                          </span>
                        ) : afterImages[i] ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                            <CheckCircle2 size={12} />Fixed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 text-orange-700">
                            <Clock size={12} />Pending
                          </span>
                        )
                      ) : isIssuePreviouslyResolved(i) ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                          <CheckCircle2 size={12} />Fixed
                        </span>
                      ) : afterImages[i] ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => {
                            const next = new Set(acceptedIndices);
                            next.add(i);
                            setAcceptedIndices(next);
                            const nextRej = new Set(unresolvedIndices);
                            nextRej.delete(i);
                            setUnresolvedIndices(nextRej);
                          }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all active:scale-[0.97] touch-manipulation select-none ${acceptedIndices.has(i) ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-sm' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
                            Accept
                          </button>
                          <button onClick={() => {
                            const next = new Set(unresolvedIndices);
                            next.add(i);
                            setUnresolvedIndices(next);
                            const nextAcc = new Set(acceptedIndices);
                            nextAcc.delete(i);
                            setAcceptedIndices(nextAcc);
                          }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all active:scale-[0.97] touch-manipulation select-none ${unresolvedIndices.has(i) ? 'bg-red-100 text-red-800 border border-red-300 shadow-sm' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500">
                          No Evidence
                        </span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No issues found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Approval Decision */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">5. Approval Decision</h3>
            {isReadOnly ? (
              <div className={`p-5 rounded-xl border ${isApproved ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${isApproved ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    {isApproved ? <CheckCircle2 size={28} /> : <X size={28} />}
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">{isApproved ? 'Approved' : 'Rejected'}</p>
                    <p className="text-sm text-slate-500">{isApproved ? 'All issues resolved and closure accepted.' : 'Closure rejected and reassigned for rework.'}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-emerald-200 rounded-xl p-5 bg-emerald-50/50">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mx-auto mb-4">
                    <CheckCircle2 size={28} />
                  </div>
                  <h4 className="text-base font-bold text-slate-900 text-center mb-2">Approve Closure</h4>
                  <p className="text-sm text-slate-500 text-center leading-relaxed mb-5">I confirm that all issues have been resolved satisfactorily.</p>
                  <button onClick={() => setShowApproveConfirm(true)} disabled={!reviewerComment.trim() || hasUnresolved || !allReviewed}
                    className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    Approve & Close
                  </button>
                </div>
                <div className="border border-red-200 rounded-xl p-5 bg-red-50/50">
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mx-auto mb-4">
                    <X size={28} />
                  </div>
                  <h4 className="text-base font-bold text-slate-900 text-center mb-2">Reject & Reassign</h4>
                  <p className="text-sm text-slate-500 text-center leading-relaxed mb-5">The corrective actions or evidence are not satisfactory.</p>
                  <button onClick={() => setShowRejectConfirm(true)} disabled={!reviewerComment.trim() || !hasUnresolved}
                    className="w-full py-3 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    Reject & Reassign
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="w-full lg:w-[42%] space-y-4 md:space-y-6">
          {/* Corrective Action Summary */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">2. Corrective Action Summary</h3>
            <p className="text-sm text-slate-500 mb-4">(by Site Engineer)</p>
            <div className="space-y-3">
              {dbItem?.corrective_action_taken ? (
                dbItem.corrective_action_taken.split('\n').filter(Boolean).map((action: string, i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-green-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-slate-700 leading-relaxed">{action.replace(/^\d+\.\s*/, '')}</span>
                  </div>
                ))
              ) : (
                correctiveActions.map((action: string, i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-green-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-slate-700 leading-relaxed">{action}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Submission Details */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">3. Submission Details</h3>
            <p className="text-sm text-slate-500 mb-4">(by Site Engineer)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Submitted By</p>
                <p className="text-sm font-semibold text-slate-900">{item?.siteEngineer || dbItem?.site_engineer || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Date & Time</p>
                <p className="text-sm font-semibold text-slate-900">{item?.submittedOn || (dbItem?.closure_se_date ? formatDateTime(dbItem.closure_se_date + 'T' + (dbItem.closure_se_time || '00:00')) : '—')}</p>
              </div>
            </div>
          </div>

          {/* Your Review */}
          {!isReadOnly && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
              <h3 className="text-lg font-semibold text-slate-900 mb-1">4. Your Review
              </h3>
              <p className="text-xs font-medium text-slate-400 mb-3">Comments (Optional)</p>
              <SpeechTextarea value={reviewerComment} onChange={(e) => setReviewerComment(e.target.value.slice(0, maxCommentLength))}
                placeholder="Enter your comments..."
                className="w-full h-[120px] resize-none rounded-lg border border-slate-200 bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400"
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-slate-400">{reviewerComment.length} / {maxCommentLength}</p>
                {!reviewerComment.trim() && <p className="text-xs text-red-500 font-medium">Required</p>}
              </div>
            </div>
          )}

          {/* Rejection Details (read-only rejected state) */}
          {isRejected && isReadOnly && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <X size={18} className="text-red-500" /> Rejection Details
              </h3>
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1">Reason</p>
                <p className="text-sm text-red-800">{dbItem?.initiator_comment || 'Corrective actions are not sufficient. Please review and resubmit with additional measures.'}</p>
              </div>
            </div>
          )}

          {/* UAUC Timeline */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">UAUC Timeline</h3>
            <div className="relative flex items-start justify-between">
              {timelineSteps.map((step, i, arr) => (
                <div key={i} className="flex flex-col items-center flex-1 relative">
                  {i < arr.length - 1 && (
                    <div className={`absolute left-[calc(50%+16px)] top-[18px] w-[calc(100%-32px)] h-0.5 ${step.completed ? 'bg-blue-500' : 'bg-slate-200'}`} />
                  )}
                  <div className={`w-[36px] h-[36px] rounded-full flex items-center justify-center text-sm font-bold z-10 shadow-sm ${
                    step.active
                      ? 'bg-orange-500 text-white ring-4 ring-orange-100'
                      : step.completed
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-400'
                  }`}>
                    {step.completed ? <CheckCircle2 size={18} /> : <span>{i + 1}</span>}
                  </div>
                  <div className="text-center mt-2.5 px-1">
                    <p className={`text-xs font-semibold leading-tight ${
                      step.active ? 'text-orange-700' : step.completed ? 'text-blue-700' : 'text-slate-400'
                    }`}>{step.label}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Approve Confirmation Modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowApproveConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={28} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Approve Closure?</h3>
              <p className="text-sm text-slate-500 mb-6">Are you sure you want to approve this closure? The site engineer will be notified.</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowApproveConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
                <button onClick={handleApprove} className="flex-1 px-4 py-2.5 bg-emerald-500 text-white rounded-lg text-sm font-bold hover:bg-emerald-600 transition-colors">Yes, Approve</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Confirmation Modal */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowRejectConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <X size={28} className="text-rose-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Reject &amp; Reassign?</h3>
              <p className="text-sm text-slate-500 mb-6">Are you sure you want to reject this closure? A rejection reason will be sent to the site engineer.</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowRejectConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
                <button onClick={handleReject} className="flex-1 px-4 py-2.5 bg-rose-500 text-white rounded-lg text-sm font-bold hover:bg-rose-600 transition-colors">Yes, Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {imagePreviewUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm" onClick={() => setImagePreviewUrl(null)}>
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Image Preview</h3>
              <button onClick={() => setImagePreviewUrl(null)} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="flex items-center justify-center p-6 bg-slate-50">
              <img src={imagePreviewUrl} alt="Preview" loading="lazy" decoding="async" className="max-w-full max-h-[65vh] object-contain rounded-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Demo Page (UAUC Closure Action) ──────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Demo page (simplified UAUC capture for demo/training)
// ---------------------------------------------------------------------------
const DemoPage = React.memo(function DemoPage({ uaucId, onBack, onClosureSubmitted, defaultStatus }: { uaucId: number | null; onBack: () => void; onClosureSubmitted?: (data: any) => void; defaultStatus?: string }) {
  const [item, setItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correctiveInput, setCorrectiveInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [afterImages, setAfterImages] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleAfterImageUpload = async (index: number, file: File) => {
    const imageData = await compressImage(file, 1920, 0.7);
    if (uaucId) {
      try {
        const response = await authFetch(`/api/uaucs/${uaucId}/pending-evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue_index: index, after_image: imageData }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Evidence upload failed (${response.status})`);
        }
      } catch (err: any) {
        alert(err?.message || 'Evidence upload failed');
        return;
      }
    }
    setAfterImages(prev => ({ ...prev, [index]: imageData }));
  };

  const removeAfterImage = async (index: number) => {
    if (uaucId) {
      try {
        const response = await authFetch(`/api/uaucs/${uaucId}/pending-evidence/${index}`, { method: 'DELETE' });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Evidence delete failed (${response.status})`);
        }
      } catch (err: any) {
        alert(err?.message || 'Evidence delete failed');
        return;
      }
    }
    setAfterImages(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleSubmitClosure = async () => {
    if (!correctiveInput.trim()) {
      alert('Please describe the corrective actions taken');
      return;
    }
    const unresolvedOnly = status === 'REWORK_REQUIRED';
    const hasAllImages = evidenceData.every((_: any, i: number) =>
      unresolvedOnly && !isIssueUnresolved(i) ? true : !!afterImages[i]
    );
    if (!hasAllImages) {
      alert('Please upload after photos for all safety issues');
      return;
    }
    if (!confirmed) {
      alert('Please confirm that corrective actions are completed');
      return;
    }
    if (!uaucId) {
      alert('Demo mode: Closure submission simulated');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/uaucs/${uaucId}/submit-closure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrective_action_taken: correctiveInput,
          closure_date_time: new Date().toISOString(),
          status: 'AWAITING_APPROVAL',
          after_images: Object.fromEntries(
            Object.entries(afterImages).filter(([_, v]) => typeof v === 'string' && !v.startsWith('http') && !v.startsWith('/api'))
          ),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (onClosureSubmitted) {
        const afterImagesArray: string[] = [];
        const issuesList = result.safety_issues || item?.safety_issues || [];
        issuesList.forEach((_: string, i: number) => {
          afterImagesArray[i] = afterImages[i] || '';
        });
        onClosureSubmitted({
          id: result.id,
          status: 'Awaiting Approval',
          uaucId: result.audit_id || `UAUC-${uaucId}`,
          location: result.location || '',
          siteEngineer: result.site_engineer || '',
          initiatedBy: item?.initiated_by || '',
          issuesFixed: result.issues_count || 0,
          raisedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          submittedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          targetDate: result.target_date || '',
          image_url: item?.image_url || null,
          safety_issues: issuesList,
          after_images: afterImagesArray,
        });
      }
      alert('Closure submitted for approval successfully');
      onBack();
    } catch (err: any) {
      alert('Failed to submit closure: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!uaucId) {
      alert('Draft saved locally (demo mode)');
      return;
    }
    try {
      const res = await authFetch(`/api/uaucs/${uaucId}/submit-closure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrective_action_taken: correctiveInput,
          closure_date_time: new Date().toISOString(),
          status: 'OPEN',
          after_images: Object.fromEntries(
            Object.entries(afterImages).filter(([_, v]) => typeof v === 'string' && !v.startsWith('http') && !v.startsWith('/api'))
          ),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setItem(result);
      alert('Draft saved');
    } catch (err: any) {
      alert('Failed to save draft: ' + (err.message || 'Unknown error'));
    }
  };

  const mockItem = {
    audit_id: 'UAUC-2025-001',
    status: 'OPEN',
    initiated_by: 'David Chen',
    observation_date: '22 May 2025',
    site_engineer: 'John Smith (You)',
    target_date: '29 May 2025',
    safety_issues: [
      'Worker not wearing helmet',
      'No safety harness at height',
      'Poor housekeeping',
      'Exposed rebar without caps',
      'Unsafe access / no barricade',
    ],
    possible_risks: [
      'Head injury due to falling objects',
      'Fall from height',
      'Trip and fall injury',
      'Impalement injury',
      'Struck by moving objects',
    ],
    recommendations: [
      'Ensure all workers wear approved PPE including helmets at all times',
      'Install and inspect safety harness anchorage points for work at height',
      'Maintain clean and organized work areas to prevent trip hazards',
      'Cover or cap all exposed rebar ends with protection caps',
      'Erect proper barricades and signage for restricted access zones',
      'Conduct safety toolbox talk and daily pre-work hazard assessment',
    ],
    issues_count: 5,
  };

  useEffect(() => {
    let cancelled = false;
    if (!uaucId) {
      setItem(mockItem);
      setCorrectiveInput(`1. Issued immediate PPE compliance notice to all workers on site.\n2. Safety harnesses inspected and replaced for 3 workers on pier formwork.\n3. Housekeeping crew deployed to clear debris and organize material storage.\n4. Rebar caps installed across all exposed sections in casting yard.\n5. Barricades erected with warning signage at all access points to restricted zones.`);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    cachedFetch(`/api/uaucs/${uaucId}`, { ttl: 30000 })
      .then((data) => {
        if (cancelled) return;
        if (defaultStatus) {
          const map: Record<string, string> = {
            'Rework Required': 'REWORK_REQUIRED',
            'Awaiting Approval': 'AWAITING_APPROVAL',
            'Approved': 'ACCEPTED',
          };
          data = { ...data, status: map[defaultStatus] || defaultStatus };
        }
        setItem(data);
        setCorrectiveInput(data.corrective_action_taken || '');
        if (data.status === 'REWORK_REQUIRED') {
          setAfterImages({});
        }
        return data;
      })
      .then((data) => {
        if (!data || cancelled) return;
        if (!data.audit_id) return;
        const mapped: Record<number, string> = {};
        const isRework = data.status === 'REWORK_REQUIRED';
        const unresolvedList: string[] = (data.unresolved_issues || '')
          .split('; ').filter(Boolean);
        if (data.pending_evidence) {
          (data.safety_issues || []).forEach((iss: string, i: number) => {
            if (isRework && unresolvedList.includes(iss)) return;
            const imgData = data.pending_evidence[String(i)];
            if (imgData) mapped[i] = typeof imgData === 'string' ? imgData : imgData.image_data || '';
          });
        }
        (data.evidence_images || []).forEach((ev: any) => {
          const idx = (data.safety_issues || []).indexOf(ev.issue_name);
          if (idx >= 0 && !mapped[idx] && !(isRework && unresolvedList.includes(ev.issue_name)) && ev.after_image_url) {
            mapped[idx] = ev.after_image_url;
          }
        });
        setAfterImages({ ...mapped });
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load UAUC'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uaucId]);

  if (!uaucId && !item) return null;

  if (loading) {
    return (
      <div className="p-4 space-y-4 page-enter">
        <div className="flex items-center gap-3 mb-4">
          <div className="skeleton w-10 h-10" />
          <div className="space-y-2 flex-1">
            <div className="skeleton h-5 w-48" />
            <div className="skeleton h-3 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
        </div>
        <div className="skeleton h-5 w-40" />
        <div className="space-y-3">
          <div className="skeleton h-24 w-full rounded-xl" />
          <div className="skeleton h-24 w-full rounded-xl" />
          <div className="skeleton h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <AlertTriangle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-sm font-medium text-red-600">{error}</p>
        <button onClick={onBack} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
          Go Back
        </button>
      </div>
    );
  }

  const data = item || mockItem;
  const issuesData = (data.safety_issues || []).map((iss: string, i: number) => ({
    issue: iss,
    risk: (data.possible_risks && data.possible_risks[i]) || '',
  }));
  const recommendationsData = data.recommendations || [];
  const issuesCount = data.issues_count || issuesData.length;
  const { audit_id, initiated_by, observation_date, site_engineer, target_date, status } = data;
  const isReadOnly = status === 'ACCEPTED' || status === 'REJECTED' || status === 'AWAITING_APPROVAL';
  const unresolvedList: string[] = (data.unresolved_issues || '').split('; ').filter(Boolean);
  const isIssueUnresolved = (index: number) => unresolvedList.includes(issuesData[index]?.issue);
  const isIssueReadOnly = (index: number) => status === 'REWORK_REQUIRED' && !isIssueUnresolved(index);

  const today = new Date().toISOString().split('T')[0];
  const computedStatus = (() => {
    if (status === 'CLOSED') return 'CLOSED';
    if (status === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
    if (status === 'REWORK_REQUIRED') return 'REWORK_REQUIRED';
    if (target_date && target_date < today) return 'OVERDUE';
    return 'OPEN';
  })();

  const statusConfig: Record<string, { label: string; className: string }> = {
    OPEN: { label: 'Open', className: 'bg-orange-100 text-orange-700' },
    CLOSED: { label: 'Closed', className: 'bg-emerald-100 text-emerald-700' },
    AWAITING_APPROVAL: { label: 'Awaiting Approval', className: 'bg-purple-100 text-purple-700' },
    REWORK_REQUIRED: { label: 'Rework Required', className: 'bg-amber-100 text-amber-700' },
    OVERDUE: { label: 'Overdue', className: 'bg-red-100 text-red-700' },
  };
  const statusInfo = statusConfig[computedStatus] || { label: computedStatus, className: 'bg-slate-100 text-slate-700' };

  const timelineSteps = (() => {
    const steps = [
      { label: 'UAUC Created', completed: true, active: false },
      { label: 'Assigned to Site Engineer', completed: true, active: false },
      { label: 'Closure Submitted', completed: computedStatus === 'AWAITING_APPROVAL' || computedStatus === 'CLOSED' || computedStatus === 'REWORK_REQUIRED', active: computedStatus === 'OPEN' },
      { label: computedStatus === 'REWORK_REQUIRED' ? 'Rework Required' : 'Awaiting Approval', completed: computedStatus === 'CLOSED', active: computedStatus === 'AWAITING_APPROVAL' || computedStatus === 'REWORK_REQUIRED' },
      { label: 'Closed', completed: computedStatus === 'CLOSED', active: false },
    ];
    return steps;
  })();

  const evidenceData = issuesData.map((row: any, i: number) => ({
    issue: `${i + 1}. ${row.issue}`,
    risk: row.risk,
  }));
  const unresolvedOnly = status === 'REWORK_REQUIRED';
  const hasAllImages = evidenceData.every((_: any, i: number) =>
    unresolvedOnly && !isIssueUnresolved(i) ? true : !!afterImages[i]
  );
  const canSubmitClosure = !!correctiveInput.trim() && hasAllImages && confirmed;

  const auditImageUrl = item?.image_url || null;

  const formatDate = (d: string) => {
    if (!d) return '--';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const pendingLabel = status === 'OPEN' ? 'Pending Closure' : statusInfo.label;
  const pendingClass = status === 'OPEN' ? 'bg-orange-100 text-orange-700' : statusInfo.className;

  const breadcrumbLabel = 'Site Engineer';

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button onClick={onBack} className="hover:text-slate-700 transition-colors font-medium">{breadcrumbLabel}</button>
        <ChevronRight size={14} />
        <span className="text-slate-800 font-semibold">UAUC Closure Action</span>
      </div>

      {/* Read-only Banner */}
      {isReadOnly && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 md:p-4 flex items-center gap-3">
          <Lock size={18} className="text-blue-500 shrink-0" />
          <p className="text-sm font-semibold text-blue-800">
            This UAUC has been <span className="uppercase">{status}</span>. All fields are read-only.
          </p>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-[32px] font-bold text-slate-900 leading-tight">UAUC Closure Action</h1>
          <p className="text-sm text-slate-500 mt-1">Review issue details, take corrective actions, upload evidence and submit for approval.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-bold text-slate-700">{audit_id}</span>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-bold ${pendingClass}`}>{pendingLabel}</span>
        </div>
      </div>

      {/* Summary Information Strip */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 divide-y sm:divide-y-0 md:divide-x divide-slate-200">
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><HardHat size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Site Engineer</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{site_engineer || '--'}</p>
            </div>
          </div>
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Flag size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Target Date</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{formatDate(target_date)}</p>
            </div>
          </div>
          <div className="p-3 md:p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Calendar size={18} className="text-blue-600" /></div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Raised Date</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{formatDate(observation_date)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Two-Column Layout */}
      <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
        {/* LEFT COLUMN */}
        <div className="w-full lg:w-[45%] space-y-4 md:space-y-6">
          {/* Card 1: Detected Safety Issues */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-5 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              1. Detected Safety Issues <span className="text-slate-400 font-normal text-base">({issuesCount})</span>
            </h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Safety Issue</th>
                  <th className="text-left pb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Potential Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issuesData.map((row: any, i: number) => (
                  <tr key={i}>
                    <td className="py-3.5 pr-3">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                        <span className="text-sm text-slate-700">{row.issue}</span>
                      </div>
                    </td>
                    <td className="py-3.5 text-sm text-slate-500">{row.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card 2: AI Recommendations */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">2. AI Recommendations (Corrective Actions)</h3>
            <div className="space-y-3">
              {recommendationsData.map((r: string, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-green-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-slate-700 leading-relaxed">{r}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: Corrective Action Taken */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">3. Corrective Action Taken <span className="text-red-500">*</span>
            </h3>
            <SpeechTextarea
              value={correctiveInput}
              onChange={(e) => { if (!isReadOnly) setCorrectiveInput(e.target.value.slice(0, 1000)); }}
              readOnly={isReadOnly}
              placeholder="Describe the corrective actions taken..."
              className={`w-full h-[140px] resize-none rounded-lg border bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400 ${isReadOnly ? 'border-slate-100 text-slate-500 cursor-not-allowed' : 'border-slate-200'}`}
            />
            <p className="text-xs text-slate-400 text-right mt-2">{correctiveInput.length} / 1000</p>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="w-full lg:w-[55%] space-y-4 md:space-y-6">
          {/* Card 4: Closure Evidence */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">4. Closure Evidence (Upload Photos) <span className="text-red-500">*</span></h3>
            <p className="text-sm text-slate-500 mb-5">Upload after images for each safety issue. Accepted formats: jpg, jpeg, png, webp. Max size: 10MB</p>

            <div className="space-y-4">
              {issuesData.map((row: any, i: number) => (
                <div key={i} className="border border-slate-200 rounded-lg p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                    {/* Issue description */}
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                      <p className="text-sm font-medium text-slate-700 leading-snug">{row.issue}</p>
                      {isIssueReadOnly(i) && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 shrink-0">
                          <CheckCircle2 size={10} />Fixed
                        </span>
                      )}
                    </div>
                    {/* BEFORE image */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2 text-center">BEFORE</p>
                      <div className="relative rounded-lg bg-slate-100 h-24 overflow-hidden border border-slate-200">
                        {auditImageUrl ? (
                          <img src={auditImageUrl} alt="Before" loading="lazy" decoding="async" className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="flex items-center justify-center h-full text-xs text-slate-400">No image</div>
                        )}
                      </div>
                    </div>
                    {/* AFTER image */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2 text-center">AFTER</p>
                      <div className="relative rounded-lg bg-green-50 h-24 overflow-hidden border border-green-200">
                        {afterImages[i] ? (
                          <div className="relative w-full h-full group">
                            <img src={afterImages[i]} alt="After" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            {!isReadOnly && !isIssueReadOnly(i) && (
                              <button onClick={() => removeAfterImage(i)}
                                className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity z-10">×</button>
                            )}
                          </div>
                        ) : !isReadOnly && (!(status === 'REWORK_REQUIRED') || isIssueUnresolved(i)) ? (
                          <div className="grid grid-cols-2 gap-2 w-full h-full">
                            <label className="flex flex-col items-center justify-center cursor-pointer rounded-lg bg-green-50 hover:bg-green-100/70 transition-colors border border-green-200">
                              <Camera size={22} className="text-green-500 mb-1" />
                              <span className="text-xs font-medium text-green-600">Camera</span>
                              <input type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAfterImageUpload(i, f); }} />
                            </label>
                            <label className="flex flex-col items-center justify-center cursor-pointer rounded-lg bg-green-50 hover:bg-green-100/70 transition-colors border border-green-200">
                              <Upload size={22} className="text-green-500 mb-1" />
                              <span className="text-xs font-medium text-green-600">Upload</span>
                              <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden"
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAfterImageUpload(i, f); }} />
                            </label>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full text-xs text-slate-400">--</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 5: Site Engineer Confirmation */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">5. Site Engineer Confirmation <span className="text-red-500">*</span></h3>
            <div className="flex-1 space-y-5">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Date & Time</p>
                  <div className="h-11 rounded-lg border border-slate-200 bg-white flex items-center px-4 text-sm text-slate-600">
                    {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <label className={`flex items-start gap-3 ${isReadOnly ? '' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={confirmed} onChange={(e) => { if (!isReadOnly) setConfirmed(e.target.checked); }} disabled={isReadOnly} className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0" />
                  <span className="text-sm text-slate-600 leading-relaxed">I confirm corrective actions are completed and issues resolved.</span>
                </label>
              </div>
            </div>
            {!isReadOnly && (
              <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-slate-100">
                <button onClick={handleSaveDraft} disabled={submitting} className="px-6 py-2.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">Save Draft</button>
                <button onClick={handleSubmitClosure} disabled={submitting || !canSubmitClosure} className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2">
                  {submitting ? 'Submitting...' : 'Submit Closure'} <Send size={15} />
                </button>
              </div>
            )}
            </div>
          </div>

      {/* Progress Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">UAUC Progress</h3>
        <div className="relative flex items-center justify-between px-1">
          {timelineSteps.map((step, i, arr) => (
            <div key={i} className="flex flex-col items-center flex-1 relative">
              {i < arr.length - 1 && (
                <div className={`absolute left-[calc(50%+18px)] top-4 w-[calc(100%-36px)] h-0.5 ${step.completed ? 'bg-blue-500' : 'bg-slate-200'}`} />
              )}
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold z-10 shadow-sm ${
                step.active
                  ? 'bg-orange-500 text-white ring-4 ring-orange-100'
                  : step.completed
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-400'
              }`}>
                {step.completed ? <CheckCircle2 size={18} /> : <span>{i + 1}</span>}
              </div>
              <p className={`text-xs font-medium text-center mt-2.5 max-w-[90px] sm:max-w-[110px] leading-snug ${
                step.active ? 'text-orange-700' : step.completed ? 'text-blue-700' : 'text-slate-400'
              }`}>{step.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ─── Mobile UAUC Closure Wizard (4-Step, Mobile-First) ────────────────────────────
// ---------------------------------------------------------------------------
// Mobile UAUC closure wizard (step-by-step for phones)
// ---------------------------------------------------------------------------
const MobileUAUCClosureWizard = React.memo(function MobileUAUCClosureWizard({ uaucId, onBack, onClosureSubmitted, defaultStatus }: { uaucId: number | null; onBack: () => void; onClosureSubmitted?: (data: any) => void; defaultStatus?: string }) {
  const [step, setStep] = useState(1);
  const [item, setItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIssueIndex, setCurrentIssueIndex] = useState(-1);
  const [correctiveInput, setCorrectiveInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [afterImages, setAfterImages] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [viewingClosure, setViewingClosure] = useState(false);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [cameraIssueIndex, setCameraIssueIndex] = useState<number | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const handleCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== currentIssueIndex) setCurrentIssueIndex(index);
  };

  const handleCarouselNext = () => {
    const el = carouselRef.current;
    if (!el) return;
    const next = Math.min(issuesData.length - 1, currentIssueIndex + 1);
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };

  const handleCarouselPrev = () => {
    const el = carouselRef.current;
    if (!el) return;
    const prev = Math.max(0, currentIssueIndex - 1);
    el.scrollTo({ left: prev * el.clientWidth, behavior: 'smooth' });
  };

  const handleCarouselDot = (index: number) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  };

  const mockItem = {
    audit_id: 'UAUC-2025-001',
    status: 'OPEN',
    initiated_by: 'David Chen',
    observation_date: '22 May 2025',
    site_engineer: 'John Smith (You)',
    target_date: '29 May 2025',
    safety_issues: [
      'Worker not wearing helmet',
      'No safety harness at height',
      'Poor housekeeping',
      'Exposed rebar without caps',
      'Unsafe access / no barricade',
    ],
    possible_risks: [
      'Head injury due to falling objects',
      'Fall from height',
      'Trip and fall injury',
      'Impalement injury',
      'Struck by moving objects',
    ],
    recommendations: [
      'Ensure all workers wear approved PPE including helmets at all times',
      'Install and inspect safety harness anchorage points for work at height',
      'Maintain clean and organized work areas to prevent trip hazards',
      'Cover or cap all exposed rebar ends with protection caps',
      'Erect proper barricades and signage for restricted access zones',
      'Conduct safety toolbox talk and daily pre-work hazard assessment',
    ],
    issues_count: 5,
  };

  useEffect(() => {
    let cancelled = false;
    if (!uaucId) {
      setItem(mockItem);
      setCorrectiveInput(`1. Issued immediate PPE compliance notice to all workers on site.\n2. Safety harnesses inspected and replaced for 3 workers on pier formwork.\n3. Housekeeping crew deployed to clear debris and organize material storage.\n4. Rebar caps installed across all exposed sections in casting yard.\n5. Barricades erected with warning signage at all access points to restricted zones.`);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    cachedFetch(`/api/uaucs/${uaucId}`, { ttl: 30000 })
      .then((data) => {
        if (cancelled) return;
        if (defaultStatus) {
          const map: Record<string, string> = {
            'Rework Required': 'REWORK_REQUIRED',
            'Awaiting Approval': 'AWAITING_APPROVAL',
            'Approved': 'ACCEPTED',
          };
          data = { ...data, status: map[defaultStatus] || defaultStatus };
        }
        setItem(data);
        setCorrectiveInput(data.corrective_action_taken || '');
        if (data.status === 'REWORK_REQUIRED') {
          setAfterImages({});
        }
        return data;
      })
      .then((data) => {
        if (!data || cancelled) return;
        if (!data.audit_id) return;
        const mapped: Record<number, string> = {};
        const isRework = data.status === 'REWORK_REQUIRED';
        const unresolvedList: string[] = (data.unresolved_issues || '').split('; ').filter(Boolean);
        if (data.pending_evidence) {
          (data.safety_issues || []).forEach((iss: string, i: number) => {
            if (isRework && unresolvedList.includes(iss)) return;
            const imgData = data.pending_evidence[String(i)];
            if (imgData) mapped[i] = typeof imgData === 'string' ? imgData : imgData.image_data || '';
          });
        }
        (data.evidence_images || []).forEach((ev: any) => {
          const idx = (data.safety_issues || []).indexOf(ev.issue_name);
          if (idx >= 0 && !mapped[idx] && !(isRework && unresolvedList.includes(ev.issue_name)) && ev.after_image_url) {
            mapped[idx] = ev.after_image_url;
          }
        });
        setAfterImages({ ...mapped });
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load UAUC'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uaucId]);

  // Reset to first issue when entering evidence upload step
  useEffect(() => {
    if (step === 2) setCurrentIssueIndex(-1);
  }, [step]);

  useEffect(() => {
    if (showCameraCapture && cameraVideoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          cameraStreamRef.current = stream;
          if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
        })
        .catch(() => {});
    }
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
    };
  }, [showCameraCapture]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-white page-enter">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="skeleton w-8 h-8 rounded-full" />
            <div className="skeleton h-5 w-32" />
          </div>
          <div className="skeleton h-4 w-24 mb-2" />
          <div className="grid grid-cols-2 gap-2.5">
            <div className="skeleton h-[72px] rounded-xl" />
            <div className="skeleton h-[72px] rounded-xl" />
            <div className="skeleton h-[72px] rounded-xl" />
            <div className="skeleton h-[72px] rounded-xl" />
          </div>
          <div className="skeleton h-5 w-24 mt-4 mb-2" />
          <div className="skeleton h-[160px] rounded-xl" />
          <div className="skeleton h-5 w-24 mt-2 mb-2" />
          <div className="skeleton h-[160px] rounded-xl" />
          <div className="flex gap-2 mt-4">
            <div className="skeleton flex-1 h-[44px] rounded-xl" />
            <div className="skeleton flex-1 h-[44px] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center px-6">
        <AlertTriangle size={40} className="text-red-400 mb-3" />
        <p className="text-sm font-medium text-red-600 mb-4">{error}</p>
        <button onClick={onBack} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">Go Back</button>
      </div>
    );
  }

  const data = item || mockItem;
  const issuesData = (data.safety_issues || []).map((iss: string, i: number) => ({
    issue: iss,
    risk: (data.possible_risks && data.possible_risks[i]) || '',
  }));
  const recommendationsData = data.recommendations || [];
  const issuesCount = data.issues_count || issuesData.length;
  const { audit_id, initiated_by, observation_date, site_engineer, target_date, status } = data;
  const isReadOnly = status === 'ACCEPTED' || status === 'REJECTED' || status === 'AWAITING_APPROVAL';
  const unresolvedList: string[] = (data.unresolved_issues || '').split('; ').filter(Boolean);
  const isIssueUnresolved = (index: number) => unresolvedList.includes(issuesData[index]?.issue);
  const unresolvedOnly = status === 'REWORK_REQUIRED';
  const hasAllImages = issuesData.every((_: any, i: number) =>
    unresolvedOnly && !isIssueUnresolved(i) ? true : !!afterImages[i]
  );
  const canSubmitClosure = !!correctiveInput.trim() && hasAllImages && confirmed;

  const auditImageUrl = item?.image_url || null;

  const formatDate = (d: string) => {
    if (!d) return '--';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const today = new Date().toISOString().split('T')[0];
  const computedStatus = (() => {
    if (status === 'CLOSED') return 'CLOSED';
    if (status === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
    if (status === 'REWORK_REQUIRED') return 'REWORK_REQUIRED';
    if (target_date && target_date < today) return 'OVERDUE';
    return 'OPEN';
  })();

  const statusConfig: Record<string, { label: string; className: string }> = {
    OPEN: { label: 'Open', className: 'bg-orange-100 text-orange-700' },
    CLOSED: { label: 'Closed', className: 'bg-emerald-100 text-emerald-700' },
    AWAITING_APPROVAL: { label: 'Awaiting Approval', className: 'bg-purple-100 text-purple-700' },
    REWORK_REQUIRED: { label: 'Rework Required', className: 'bg-amber-100 text-amber-700' },
    OVERDUE: { label: 'Overdue', className: 'bg-red-100 text-red-700' },
  };
  const statusInfo = statusConfig[computedStatus] || { label: computedStatus, className: 'bg-slate-100 text-slate-700' };

  const handleAfterImageUpload = async (index: number, file: File) => {
    const imageData = await compressImage(file, 1920, 0.7);
    if (uaucId) {
      try {
        const response = await authFetch(`/api/uaucs/${uaucId}/pending-evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue_index: index, after_image: imageData }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Evidence upload failed (${response.status})`);
        }
      } catch (err: any) {
        alert(err?.message || 'Evidence upload failed');
        return;
      }
    }
    setAfterImages(prev => ({ ...prev, [index]: imageData }));
  };

  const removeAfterImage = async (index: number) => {
    if (uaucId) {
      try {
        const response = await authFetch(`/api/uaucs/${uaucId}/pending-evidence/${index}`, { method: 'DELETE' });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Evidence delete failed (${response.status})`);
        }
      } catch (err: any) {
        alert(err?.message || 'Evidence delete failed');
        return;
      }
    }
    setAfterImages(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleCameraCapture = (index: number) => {
    setCameraIssueIndex(index);
    setShowCameraCapture(true);
  };

  const capturePhoto = () => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas || cameraIssueIndex === null) return;
    let w = video.videoWidth, h = video.videoHeight;
    const maxDim = 1920;
    if (w > maxDim || h > maxDim) {
      const r = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    setAfterImages(prev => ({ ...prev, [cameraIssueIndex]: dataUrl }));
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    setShowCameraCapture(false);
    setCameraIssueIndex(null);
  };

  const handleSubmitClosure = async () => {
    if (!correctiveInput.trim()) { alert('Please describe the corrective actions taken'); return; }
    if (!hasAllImages) { alert('Please upload after photos for all safety issues'); return; }
    if (!confirmed) { alert('Please confirm that corrective actions are completed'); return; }
    if (!uaucId) { alert('Demo mode: Closure submission simulated'); onBack(); return; }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/uaucs/${uaucId}/submit-closure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrective_action_taken: correctiveInput,
          closure_date_time: new Date().toISOString(),
          status: 'AWAITING_APPROVAL',
          after_images: Object.fromEntries(
            Object.entries(afterImages).filter(([_, v]) => typeof v === 'string' && !v.startsWith('http') && !v.startsWith('/api'))
          ),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (onClosureSubmitted) {
        const afterImagesArray: string[] = [];
        const issuesList = result.safety_issues || item?.safety_issues || [];
        issuesList.forEach((_: string, i: number) => { afterImagesArray[i] = afterImages[i] || ''; });
        onClosureSubmitted({
          id: result.id, status: 'Awaiting Approval',
          uaucId: result.audit_id || `UAUC-${uaucId}`,
          location: result.location || '', siteEngineer: result.site_engineer || '',
          initiatedBy: item?.initiated_by || '', issuesFixed: result.issues_count || 0,
          raisedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          submittedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          targetDate: result.target_date || '', image_url: item?.image_url || null,
          safety_issues: issuesList, after_images: afterImagesArray,
        });
      }
      setShowSuccess(true);
      setTimeout(() => { setShowSuccess(false); onBack(); }, 2000);
    } catch (err: any) {
      alert('Failed to submit closure: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!uaucId) { alert('Draft saved locally (demo mode)'); return; }
    try {
      const res = await authFetch(`/api/uaucs/${uaucId}/submit-closure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrective_action_taken: correctiveInput,
          closure_date_time: new Date().toISOString(),
          status: 'OPEN',
          after_images: Object.fromEntries(
            Object.entries(afterImages).filter(([_, v]) => typeof v === 'string' && !v.startsWith('http') && !v.startsWith('/api'))
          ),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setItem(result);
      alert('Draft saved');
    } catch (err: any) { alert('Failed to save draft: ' + (err.message || 'Unknown error')); }
  };

  const canProceedFromStep = (s: number) => {
    if (isReadOnly) return true;
    if (s === 1) return true;
    if (s === 2) return hasAllImages;
    if (s === 3) return !!correctiveInput.trim();
    return true;
  };

  const handleContinue = () => {
    if (!canProceedFromStep(step)) {
      if (step === 2) { alert('Please upload after photos for all safety issues before proceeding'); return; }
      if (step === 3) { alert('Please describe the corrective actions taken'); return; }
    }
    if (step < 4) setStep(s => s + 1);
  };

  const workflowSteps = [
    { label: 'Issues', icon: AlertTriangle },
    { label: 'AI Recs', icon: CheckCircle2 },
    { label: 'Evidence', icon: Upload },
    { label: 'Actions', icon: Edit3 },
    { label: 'Confirm', icon: CheckSquare },
  ];

  const stepLabels = ['Overview', 'Evidence', 'Actions & Confirm'];

  // ── Camera Modal (matching UAUC Capture style) ──
  const cameraModal = showCameraCapture && (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <button onClick={() => { setShowCameraCapture(false); if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; } }}
          className="text-white text-sm font-semibold">Cancel</button>
        <span className="text-white text-sm font-medium">Capture Photo</span>
        <div className="w-14" />
      </div>
      <div className="flex-1 relative">
        <video ref={cameraVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <canvas ref={cameraCanvasRef} className="hidden" />
      </div>
      <div className="flex justify-center py-6 bg-black/80">
        <button onClick={capturePhoto}
          className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center hover:opacity-80 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-white" />
        </button>
      </div>
    </div>
  );

  // ── View Closure Screen ──
  if (viewingClosure) {
    const isIssueReadOnlyFn = (i: number) => status === 'REWORK_REQUIRED' && !isIssueUnresolved(i);
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col page-enter">
        <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3 px-4 h-12">
            <button onClick={() => setViewingClosure(false)} className="p-1 -ml-1 text-slate-500"><ChevronLeft size={22} /></button>
            <h1 className="text-[17px] font-bold text-slate-900">Closure Summary</h1>
            <span className={`ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold ${statusInfo.className}`}>{statusInfo.label}</span>
          </div>
        </div>
        <div className="flex-1 pb-28">
          <div className="px-4 pt-1.5 pb-1.5 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-3">Detected Safety Issues</h3>
              {issuesData.map((row: any, i: number) => (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${isIssueReadOnlyFn(i) ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{row.issue}</p>
                    <p className="text-xs text-slate-500">{row.risk}</p>
                    {afterImages[i] && (
                      <img src={afterImages[i]} alt="After" loading="lazy" decoding="async" className="mt-2 w-full h-24 object-cover rounded-lg border border-slate-200" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-2">Corrective Actions</h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{correctiveInput || '--'}</p>
            </div>

          </div>
        </div>
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
          <button onClick={onBack} className="w-full h-[48px] rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 touch-feedback">Back to Dashboard</button>
        </div>
      </div>
    );
  }

  // ── Main Wizard Layout (UAUC Capture design system) ──
  return (
    <div className="fixed inset-0 z-[100] bg-[#F8FAFC] flex flex-col">
      {/* Camera Modal */}
      {cameraModal}

      {/* ─── Sticky Header ─── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="flex items-center px-4 h-12">
          <button onClick={onBack} className="p-1 -ml-1"><ChevronLeft size={22} className="text-slate-700" /></button>
          <div className="flex-1 text-center">
            <h1 className="text-[17px] font-bold text-slate-900">UAUC Closure</h1>
            <p className="text-[11px] text-slate-500 -mt-0.5">{audit_id}</p>
          </div>
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${statusInfo.className}`}>{statusInfo.label}</span>
        </div>
        {/* Step Progress Bar */}
        <div className="px-4 pb-2">
          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${step === 1 ? 'w-1/3' : step === 2 ? 'w-2/3' : 'w-full'} bg-blue-600`} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] font-medium text-slate-400 px-0.5">
            {stepLabels.map((label, i) => (
              <span key={i} className={step >= i + 1 ? 'text-blue-600' : ''}>{label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Scrollable Body (pb-28 for bottom bar) ─── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* ═══ Step 1: Overview ═══ */}
        {step === 1 && (
          <div className="flex-1 flex flex-col animate-fade-in overflow-y-auto pb-16">
            {/* Info Cards */}
            <div className="shrink-0 px-4 pt-1.5 pb-1.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-xl border border-slate-200 p-2.5">
                  <Calendar size={13} className="text-blue-500 mb-1" />
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Raised Date</p>
                  <p className="text-xs font-semibold text-slate-900 mt-0.5 truncate">{formatDate(observation_date)}</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-2.5">
                  <HardHat size={13} className="text-blue-500 mb-1" />
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Site Engineer</p>
                  <p className="text-xs font-semibold text-slate-900 mt-0.5 truncate">{site_engineer || '--'}</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-2.5">
                  <Flag size={13} className="text-blue-500 mb-1" />
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Target Date</p>
                  <p className="text-xs font-semibold text-slate-900 mt-0.5 truncate">{formatDate(target_date)}</p>
                </div>
              </div>
            </div>

            {/* Detected Issues Carousel */}
            <div className="bg-white px-4 py-2 border-b border-slate-100 shrink-0 max-h-[50vh] flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h2 className="text-sm font-bold text-slate-800">Detected Issues</h2>
                {!showAllIssues && (
                  <button onClick={() => setShowAllIssues(true)} className="text-[13px] font-semibold text-blue-600">View All</button>
                )}
              </div>
              {showAllIssues ? (
                <div className="flex-1 space-y-1.5 overflow-y-auto min-h-0 animate-fade-in">
                  {issuesData.map((row: any, i: number) => {
                    const isResolved = unresolvedOnly && !isIssueUnresolved(i);
                    return (
                      <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${isResolved ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-100 bg-white'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${isResolved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            {isResolved && <span className="text-[10px] font-bold text-emerald-600">✓ Resolved</span>}
                          </div>
                          <p className={`text-xs font-semibold ${isResolved ? 'text-slate-500' : 'text-slate-800'}`}>{row.issue}</p>
                          <p className={`text-[10px] mt-0.5 ${isResolved ? 'text-slate-400' : 'text-slate-500'}`}>Risk: {row.risk}</p>
                          {auditImageUrl && (
                            <div className="mt-1.5 rounded-lg overflow-hidden border border-slate-200 h-[80px]">
                              <img src={auditImageUrl} alt="Issue" loading="lazy" decoding="async" className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={() => setShowAllIssues(false)} className="w-full h-[44px] rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5">
                    <ChevronRight size={16} className="rotate-90" /> Show Less
                  </button>
                </div>
              ) : issuesData.length > 0 && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="relative rounded-2xl bg-white border border-slate-100 shadow-sm flex-1 flex flex-col min-h-0">
                    <div ref={carouselRef} onScroll={handleCarouselScroll}
                      className="flex overflow-x-auto scroll-smooth hide-scrollbar flex-1 min-h-0"
                      style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
                      {issuesData.map((row: any, i: number) => {
                        const isResolved = unresolvedOnly && !isIssueUnresolved(i);
                        return (
                          <div key={i} className="w-full shrink-0 px-3 py-3"
                            style={{ scrollSnapAlign: 'start', flex: '0 0 100%' }}>
                            <div className="flex gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{i + 1} of {issuesData.length}</span>
                                </div>
                                <p className={`text-sm font-bold leading-tight mb-1.5 ${isResolved ? 'text-slate-500' : 'text-slate-900'}`}>{row.issue}</p>
                                <p className="text-[11px] font-semibold text-slate-500 mb-0.5">Risk</p>
                                <p className={`text-[11px] leading-snug ${isResolved ? 'text-slate-400' : 'text-slate-600'}`}>{row.risk || 'No risk information available'}</p>
                              </div>
                              <div className="w-[45%] shrink-0">
                                <div className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: '1/1', maxHeight: '140px' }}>
                                  {auditImageUrl ? (
                                    <img src={auditImageUrl} alt="Issue" loading="lazy" decoding="async" className="w-full h-full object-cover"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Camera size={24} className="text-slate-300" />
                </div>
              )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {currentIssueIndex < issuesData.length - 1 && (
                      <button onClick={handleCarouselNext}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors z-10">
                        <ChevronRight size={14} className="text-slate-600" />
                      </button>
                    )}
                    {currentIssueIndex > 0 && (
                      <button onClick={handleCarouselPrev}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors z-10">
                        <ChevronRight size={14} className="text-slate-600 rotate-180" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 mt-2 shrink-0">
                    {issuesData.map((_: any, i: number) => (
                      <button key={i} onClick={() => handleCarouselDot(i)}
                        className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${i === currentIssueIndex ? 'bg-blue-600 w-3' : 'bg-slate-300'}`} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* AI Recommendations */}
            <div className="bg-white px-4 py-2 border-b border-slate-100 flex-1 overflow-y-auto min-h-0">
              <h2 className="text-sm font-bold text-slate-800 mb-1.5 flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-500" />
                AI Recommendations
              </h2>
              <div className="space-y-1.5">
                {recommendationsData.map((r: string, i: number) => (
                  <p key={i} className="text-xs text-slate-600 flex gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                    {r}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ Step 2: Evidence Upload ═══ */}
        {step === 2 && (
          <div className="animate-fade-in px-4 pt-3 pb-4 space-y-2.5 overflow-y-auto">
            <p className="text-[13px] text-slate-500 mb-1">Upload evidence for each issue</p>

            {issuesData.map((row: any, i: number) => {
              const canEdit = !isReadOnly && (!unresolvedOnly || isIssueUnresolved(i));
              const isRejectedStatus = unresolvedOnly && isIssueUnresolved(i);
              const isResolvedStatus = unresolvedOnly && !isIssueUnresolved(i);
              const isExpanded = i === currentIssueIndex;
              const hasUploaded = !!afterImages[i];
              return (
                <div key={i}>
                  <div
                    className={`bg-white rounded-xl border shadow-sm transition-all ${
                      isExpanded ? 'border-blue-200 shadow-md' : isResolvedStatus ? 'border-emerald-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-800">{row.issue}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${row.risk === 'High' ? 'bg-red-100 text-red-700' : row.risk === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                              {row.risk}
                            </span>
                          </div>
                          {!isExpanded && hasUploaded && (
                            <p className="text-[11px] text-emerald-600 font-medium mt-0.5 flex items-center gap-1">
                              <CheckCircle2 size={12} /> Evidence uploaded
                            </p>
                          )}
                          {!isExpanded && isRejectedStatus && !hasUploaded && (
                            <p className="text-[11px] text-red-500 font-medium mt-0.5 flex items-center gap-1">
                              <AlertTriangle size={12} /> Evidence required
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {isResolvedStatus && (
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">Approved</span>
                          )}
                          {isRejectedStatus && !isExpanded && (
                            <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">Rejected</span>
                          )}
                          <button onClick={() => setCurrentIssueIndex(isExpanded ? -1 : i)}
                            className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                            <ChevronDown size={16} className={`text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                        {/* Rejected label */}
                        {isRejectedStatus && (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 text-[11px] font-bold">
                            Rejected — Evidence Required
                          </div>
                        )}

                        {/* Before Image */}
                        {auditImageUrl && (
                          <div>
                            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Before (Original Issue)</p>
                            <div className="rounded-xl bg-slate-100 h-[140px] overflow-hidden border border-slate-200">
                              <img src={auditImageUrl} alt="Before" loading="lazy" decoding="async" className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            </div>
                          </div>
                        )}

                        {/* After Upload */}
                        <div>
                          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">After (Upload Evidence) <span className="text-rose-500">*</span></p>
                          {hasUploaded ? (
                            <div className="relative rounded-xl overflow-hidden border border-emerald-200 h-[160px] group">
                              <img src={afterImages[i]} alt="After" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                              {canEdit && (
                                <button onClick={() => removeAfterImage(i)}
                                  className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full text-sm font-bold flex items-center justify-center hover:bg-red-600 transition-colors z-10 shadow-md">×</button>
                              )}
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-emerald-500/80 text-white text-[9px] font-bold">Uploaded</div>
                            </div>
                          ) : canEdit ? (
                            <div className="grid grid-cols-2 gap-2 w-full h-[140px]">
                              <button onClick={() => handleCameraCapture(i)}
                                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 transition-colors">
                                <Camera size={28} className="text-slate-400 mb-1" />
                                <p className="text-sm font-semibold text-slate-600">Camera</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Open camera</p>
                              </button>
                              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                                <Upload size={28} className="text-slate-400 mb-1" />
                                <p className="text-sm font-semibold text-slate-600">Upload</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Browse files</p>
                                <input type="file" accept="image/*" className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAfterImageUpload(i, f); }} />
                              </label>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center w-full h-[140px] rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-400">No evidence</div>
                          )}
                          {!hasUploaded && isRejectedStatus && (
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-500 mt-1.5">
                              <AlertTriangle size={13} /> This evidence is required
                            </p>
                          )}
                          {hasUploaded && (
                            <div className="px-2 py-1.5 bg-emerald-50 rounded-lg text-[11px] font-medium text-emerald-700 flex items-center gap-1.5 mt-1.5">
                              <CheckCircle2 size={13} /> Uploaded successfully
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Info Banner */}
            {unresolvedOnly && (
              <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
                <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-blue-700 leading-relaxed">Only previously rejected issues are shown. Upload evidence for each and resubmit.</p>
              </div>
            )}
          </div>
        )}

        {/* ═══ Step 3: Corrective Actions & Confirmation ═══ */}
        {step === 3 && (
          <div className="flex-1 flex flex-col animate-fade-in overflow-y-auto pb-16">
            <div className="bg-white px-4 py-2 border-b border-slate-100 flex-1 flex flex-col min-h-0">
              <h2 className="text-sm font-bold text-slate-800 mb-2 shrink-0">Corrective Action Taken <span className="text-rose-500">*</span>
              </h2>
              <SpeechTextarea
                value={correctiveInput}
                onChange={(e) => { if (!isReadOnly) setCorrectiveInput(e.target.value.slice(0, 1000)); }}
                readOnly={isReadOnly}
                placeholder="Describe the corrective actions taken..."
                className="w-full h-full min-h-[120px] resize-none rounded-xl border bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400"
              />
              <p className="text-[11px] text-slate-400 text-right mt-1 shrink-0">{correctiveInput.length} / 1000</p>
            </div>

            <div className="bg-white px-4 pt-1.5 pb-3 border-b border-slate-100 shrink-0">
              <h2 className="text-sm font-bold text-slate-800 mb-3">Site Engineer Confirmation <span className="text-rose-500">*</span></h2>
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-600 mb-1 block">Date & Time</p>
                <div className="w-full h-[44px] px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 flex items-center">
                  {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer pb-1">
                <input type="checkbox" checked={confirmed} onChange={(e) => { if (!isReadOnly) setConfirmed(e.target.checked); }} disabled={isReadOnly} className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0" />
                <span className="text-sm text-slate-600 leading-relaxed">I confirm all corrective actions have been completed and the identified safety issues are resolved.</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ─── Fixed Bottom Bar ─── */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
        <div className="flex gap-2.5">
          {step > 1 ? (
            <button onClick={() => setStep(s => s - 1)} disabled={submitting}
              className="flex-1 h-[44px] rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50">
              Previous
            </button>
          ) : (
            <button onClick={onBack} className="flex-1 h-[44px] rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
          )}
          {!isReadOnly && step !== 3 && (
            <button onClick={handleSaveDraft} disabled={submitting}
              className="h-[44px] px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50">
              Save Draft
            </button>
          )}
          {step < 3 ? (
            <button onClick={handleContinue}
              className="flex-1 h-[44px] rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm">
              Continue
            </button>
          ) : (
            <button onClick={handleSubmitClosure} disabled={submitting || (!isReadOnly && !canSubmitClosure)}
              className="flex-1 h-[44px] rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2">
              {submitting ? <Activity size={18} className="animate-spin" /> : <Send size={15} />}
              {submitting ? 'Submitting...' : 'Submit Closure'}
            </button>
          )}
        </div>
        {isReadOnly && (
          <p className="text-[11px] text-slate-400 text-center mt-2">This UAUC is {status}. All fields are read-only.</p>
        )}
      </div>

      {/* Success Popup */}
      {showSuccess && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center" onClick={() => { setShowSuccess(false); onBack(); }}>
          <div className="bg-white rounded-2xl mx-6 p-6 w-full max-w-sm text-center animate-fade-in shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Closure Submitted!</h2>
            <p className="text-sm text-slate-500 leading-relaxed">Your UAUC closure has been submitted for approval successfully.</p>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Mobile UAUC Approval Page ──────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Mobile UAUC approval page (phone-optimized EHSO review)
// ---------------------------------------------------------------------------
const MobileUAUCApprovalPage = React.memo(function MobileUAUCApprovalPage({ item, onBack, onDecision, numericId, onDecisionComplete }: {
  item: any; onBack: () => void;
  onDecision?: (uaucId: string, status: 'accepted' | 'rejected', comment: string, unresolvedIssues?: string) => void;
  numericId?: number | null;
  onDecisionComplete?: (currentId?: number) => void;
}) {
  const [currentIssueIndex, setCurrentIssueIndex] = useState(-1);
  const [dbItem, setDbItem] = useState<any>(null);
  const [afterImages, setAfterImages] = useState<string[]>([]);
  const [unresolvedIndices, setUnresolvedIndices] = useState<Set<number>>(new Set());
  const [acceptedIndices, setAcceptedIndices] = useState<Set<number>>(new Set());
  const [finalDecision, setFinalDecision] = useState<'approve' | 'reject' | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ corrective: false, submission: false, timeline: false });
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [reviewPage, setReviewPage] = useState(item?.status === 'Approved' || item?.status === 'Rejected' || item?.status === 'Rework Required' ? 2 : 1);
  const [isApproved, setIsApproved] = useState(item?.status === 'Approved');
  const [isRejected, setIsRejected] = useState(item?.status === 'Rejected' || item?.status === 'Rework Required');
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectedIndices, setRejectedIndices] = useState<Set<number>>(new Set());
  const maxCommentLength = 500;
  const issues = item?.safety_issues || [];
  const formatDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };
  const formatDateTime = (d: string) => {
    if (!d) return '—';
    try { const dt = new Date(d); return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };
  const isIssuePreviouslyResolved = (index: number): boolean => {
    if (!dbItem?.unresolved_issues) return false;
    const unresolved = (dbItem.unresolved_issues as string).split('; ').filter(Boolean);
    const issue = issues[index];
    return !unresolved.includes(issue);
  };
  const isIssueRejected = (index: number): boolean => {
    if (rejectedIndices.size > 0) return rejectedIndices.has(index);
    if (isRejected && dbItem?.unresolved_issues) {
      const unresolved = (dbItem.unresolved_issues as string).split('; ').filter(Boolean);
      const issue = issues[index];
      return unresolved.includes(issue);
    }
    return false;
  };
  const isReadOnly = isApproved || isRejected;
  const statusBadgeLabel = isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Awaiting Approval';
  const statusBadgeClass = isApproved ? 'bg-emerald-100 text-emerald-700' : isRejected ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700';

  useEffect(() => {
    if (!numericId) return;
    let cancelled = false;
    const issuesList = item?.safety_issues || [];
    cachedFetch(`/api/uaucs/${numericId}`, { ttl: 30000 })
      .then(data => {
        if (cancelled) return;
        setDbItem(data);
        const mapped = issuesList.map((_: string) => '');
        if (data.pending_evidence && Object.keys(data.pending_evidence).length > 0) {
          issuesList.forEach((iss: string, i: number) => {
            const imgData = data.pending_evidence[String(i)];
            if (imgData) mapped[i] = typeof imgData === 'string' ? imgData : imgData.image_data || '';
          });
        }
        const isRework = data.status === 'REWORK_REQUIRED';
        const unresolvedList: string[] = (data.unresolved_issues || '')
          .split('; ').filter(Boolean);
        (data.evidence_images || []).forEach((ev: { issue_name: string; after_image_url: string | null }) => {
          const idx = issuesList.indexOf(ev.issue_name);
          if (idx >= 0 && !mapped[idx] && !(isRework && unresolvedList.includes(ev.issue_name)) && ev.after_image_url) mapped[idx] = ev.after_image_url;
        });
        setAfterImages(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [numericId]);

  const correctiveActions = dbItem?.corrective_action_taken
    ? dbItem.corrective_action_taken.split('\n').filter(Boolean)
    : ['Workers instructed to wear helmets', 'Missing helmets issued', 'Area cleaned', 'Rebar capped', 'PPE compliance verified'];

  const createdDate = dbItem?.observation_date ? formatDate(dbItem.observation_date) : item?.raisedOn || '—';
  const closureDate = dbItem?.closure_se_date ? formatDate(dbItem.closure_se_date) : null;
  const closureDateTime = dbItem?.closure_se_date ? formatDateTime(dbItem.closure_se_date + 'T' + (dbItem.closure_se_time || '00:00')) : '—';
  const closureSubmitted = !!(dbItem?.closure_se_date || item?.submittedOn);
  const hasUnresolved = unresolvedIndices.size > 0;

  const toggleUnresolved = (index: number) => {
    if (isReadOnly) return;
    setUnresolvedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handleApprove = async () => {
    if (!reviewComment.trim()) return;
    try {
      await onDecision?.(item?.uaucId, 'accepted', reviewComment);
      setIsApproved(true);
      setShowApproveConfirm(false);
      onDecisionComplete?.(numericId ?? undefined);
    } catch (err: any) {
      alert(err?.message || 'Approval failed');
    }
  };

  const handleReject = async () => {
    if (!reviewComment.trim()) return;
    const unresolvedStr = unresolvedIndices.size > 0
      ? [...unresolvedIndices].sort().map(i => issues[i]).join('; ')
      : '';
    try {
      await onDecision?.(item?.uaucId, 'rejected', reviewComment, unresolvedStr);
      setIsRejected(true);
      setRejectedIndices(new Set(unresolvedIndices));
      setShowRejectConfirm(false);
      onDecisionComplete?.(numericId ?? undefined);
    } catch (err: any) {
      alert(err?.message || 'Rejection failed');
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const currentIssue = issues[currentIssueIndex];
  const allReviewed = issues.every((__: string, i: number) => isIssuePreviouslyResolved(i) || acceptedIndices.has(i) || unresolvedIndices.has(i));
  const canApprove = !!reviewComment.trim() && !hasUnresolved && allReviewed;
  const canReject = !!reviewComment.trim() && hasUnresolved;

  const imagePreviewModal = imagePreviewUrl && (
    <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center" onClick={() => setImagePreviewUrl(null)}>
      <div className="relative max-w-full max-h-full p-4" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setImagePreviewUrl(null)} className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white z-10"><X size={18} /></button>
        <img src={imagePreviewUrl} alt="Preview" loading="lazy" decoding="async" className="max-w-full max-h-[80vh] object-contain rounded-xl" />
      </div>
    </div>
  );

  const timelineSteps = [
    { label: 'UAUC Created', detail: createdDate, user: item?.initiatedBy || '—', completed: true },
    { label: 'Assigned to', detail: formatDate((dbItem || item)?.target_date || ''), user: item?.siteEngineer || (dbItem || item)?.site_engineer || '—', completed: true },
    { label: 'Closure Submitted', detail: closureDate || closureDateTime, user: item?.siteEngineer || (dbItem || item)?.site_engineer || '—', completed: closureSubmitted || isReadOnly },
    { label: isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Pending Approval', detail: isReadOnly ? formatDate(new Date().toISOString()) : '—', user: isReadOnly ? 'You' : '—', completed: isReadOnly },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-[#F8FAFC] flex flex-col">
      {imagePreviewModal}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="flex items-center px-4 h-12">
          <button onClick={reviewPage === 2 ? () => setReviewPage(1) : onBack} className="p-1 -ml-1"><ChevronLeft size={22} className="text-slate-700" /></button>
          <div className="flex-1 text-center">
            <h1 className="text-[17px] font-bold text-slate-900">{reviewPage === 2 ? 'Review & Decision' : isReadOnly ? (isApproved ? 'View Closure Report' : 'View Rejection Details') : 'UAUC Approval'}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {isReadOnly && <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${statusBadgeClass}`}>{statusBadgeLabel}</span>}
          </div>
        </div>
        {/* Step indicator */}
        {!isReadOnly ? (
          <div className="px-4 pb-2">
            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${reviewPage === 1 ? 'w-1/2' : 'w-full'} bg-blue-600`} />
            </div>
            <div className="flex justify-between mt-1 text-[10px] font-medium text-slate-400 px-0.5">
              <span className={reviewPage === 1 ? 'text-blue-600' : ''}>Issues</span>
              <div className="flex items-center gap-2">
                <span className={reviewPage === 2 ? 'text-blue-600' : ''}>Decision</span>
                <span className="text-slate-300 font-bold">{item?.uaucId || '—'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 border-t border-blue-100 px-4 py-2">
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-blue-500 shrink-0" />
              <p className="text-xs font-medium text-blue-700">
                {isApproved ? 'This UAUC has been approved. All fields are read-only.' : 'This UAUC has been rejected. All fields are read-only.'}
              </p>
              <span className="ml-auto text-[10px] font-bold text-slate-500">{item?.uaucId || '—'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Approve Confirmation Modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-end justify-center" onClick={() => setShowApproveConfirm(false)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-6 pb-8 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center mb-5">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3"><CheckCircle2 size={28} className="text-emerald-600" /></div>
              <h2 className="text-lg font-bold text-slate-900">Approve Closure?</h2>
              <p className="text-sm text-slate-500 text-center mt-1">This will mark the UAUC as approved and close all issues.</p>
            </div>
            <button onClick={handleApprove} disabled={!reviewComment.trim()}
              className="w-full h-[48px] rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors mb-2 touch-feedback">
              <CheckCircle2 size={16} /> Yes, Approve
            </button>
            <button onClick={() => setShowApproveConfirm(false)}
              className="w-full h-[48px] rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Reject Confirmation Modal */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-end justify-center" onClick={() => setShowRejectConfirm(false)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-6 pb-8 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center mb-5">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-3"><X size={28} className="text-red-600" /></div>
              <h2 className="text-lg font-bold text-slate-900">Reject &amp; Reassign?</h2>
              <p className="text-sm text-slate-500 text-center mt-1">This will reject the closure and notify the site engineer to rework the issues.</p>
              {!hasUnresolved && <p className="text-xs text-red-500 font-semibold mt-2">Please mark at least one issue as rejected before rejecting the closure.</p>}
            </div>
            <button onClick={handleReject} disabled={!reviewComment.trim() || !hasUnresolved}
              className="w-full h-[48px] rounded-xl bg-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700 transition-colors mb-2 touch-feedback">
              <X size={16} /> Yes, Reject
            </button>
            <button onClick={() => setShowRejectConfirm(false)}
              className="w-full h-[48px] rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
      {reviewPage === 1 ? (
        <>
          <div className="flex-1 pb-28 overflow-y-auto animate-fade-in">
            {/* 2-column Info Cards */}
            <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-2">
              <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5 col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Initiated By</p>
                <p className="text-sm font-bold text-slate-800">{item?.initiatedBy || dbItem?.initiated_by || '—'}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(createdDate.toString())}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Target Date</p>
                <p className="text-sm font-bold text-slate-800">{(dbItem || item)?.target_date ? formatDate((dbItem || item).target_date) : (item.date || '—')}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Site Engineer</p>
                <p className="text-sm font-bold text-slate-800">{item?.siteEngineer || (dbItem || item)?.site_engineer || '—'}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Location</p>
                <p className="text-sm font-bold text-slate-800">{item?.location || (dbItem || item)?.location || '—'}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total Issues</p>
                <p className="text-sm font-bold text-slate-800">{issues.length}</p>
              </div>
            </div>

            {/* Issue List */}
            <div className="px-4 pb-3 space-y-2.5">
              {issues.map((iss: string, i: number) => {
                const hasEvidence = !!afterImages[i];
                const isPreviouslyResolved = isIssuePreviouslyResolved(i);
                const isExplicitlyAccepted = acceptedIndices.has(i);
                const isExplicitlyRejected = unresolvedIndices.has(i);
                const isPending = !isExplicitlyAccepted && !isExplicitlyRejected && !isPreviouslyResolved;
                const isExpanded = !isReadOnly && i === currentIssueIndex;
                return (
                  <div key={i}>
                    <div
                      className={`bg-white rounded-xl border shadow-sm transition-all ${
                        isExpanded ? 'border-blue-200 shadow-md' : isPreviouslyResolved ? 'border-emerald-100 bg-emerald-50/30' : isExplicitlyAccepted ? 'border-emerald-100' : isExplicitlyRejected ? 'border-red-100' : 'border-slate-200'
                      }`}
                    >
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800">{iss}</p>
                            {(dbItem?.possible_risks?.[i]) && (
                              <p className="text-[11px] text-slate-500 mt-0.5">{dbItem.possible_risks[i]}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {isPreviouslyResolved && !isExpanded && (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">Fixed</span>
                            )}
                            {!isPreviouslyResolved && isExplicitlyAccepted && !isExpanded && (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">Accepted</span>
                            )}
                            {!isPreviouslyResolved && isExplicitlyRejected && !isExpanded && (
                              <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">Rejected</span>
                            )}
                            {!isPreviouslyResolved && isPending && !hasEvidence && (
                              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">No Evidence</span>
                            )}
                            {!isReadOnly && (
                              <button onClick={() => setCurrentIssueIndex(isExpanded ? -1 : i)}
                                className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                                <ChevronDown size={16} className={`text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                          {/* Before Image */}
                          <div>
                            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Before (Original Issue)</p>
                            <div className="relative rounded-xl overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: '16/9' }}>
                              {item?.image_url ? (
                                <>
                                  <img src={item.image_url} alt="Before" loading="lazy" decoding="async" className="w-full h-full object-cover cursor-pointer" onClick={() => setImagePreviewUrl(item.image_url)} />
                                  <button onClick={() => setImagePreviewUrl(item.image_url)} className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/90 shadow flex items-center justify-center"><Eye size={14} className="text-slate-600" /></button>
                                </>
                              ) : (
                                <div className="flex items-center justify-center h-full text-xs text-slate-400">No image</div>
                              )}
                              <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded leading-none">Before</span>
                            </div>
                          </div>

                          {/* After Image */}
                          <div>
                            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">After (Submitted by Site Engineer)</p>
                            <div className="relative rounded-xl overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: '16/9' }}>
                              {hasEvidence ? (
                                <>
                                  <img src={afterImages[i]} alt="After" loading="lazy" decoding="async" className="w-full h-full object-cover cursor-pointer" onClick={() => setImagePreviewUrl(afterImages[i])} />
                                  <button onClick={() => setImagePreviewUrl(afterImages[i])} className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/90 shadow flex items-center justify-center"><Eye size={14} className="text-slate-600" /></button>
                                </>
                              ) : (
                                <div className="flex items-center justify-center h-full text-xs text-slate-400">No evidence submitted</div>
                              )}
                              <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-green-600 text-white text-[9px] font-bold rounded leading-none">After</span>
                            </div>
                          </div>

                          {/* Accept / Reject */}
                          {isPreviouslyResolved ? (
                            <div className="px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-xs font-medium text-emerald-700 flex items-center gap-2">
                              <CheckCircle2 size={14} /> This issue was previously resolved and accepted.
                            </div>
                          ) : hasEvidence ? (
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => {
                                const nextAcc = new Set(acceptedIndices);
                                nextAcc.add(i);
                                setAcceptedIndices(nextAcc);
                                const nextRej = new Set(unresolvedIndices);
                                nextRej.delete(i);
                                setUnresolvedIndices(nextRej);
                              }}
                                className={`flex-1 h-[44px] rounded-xl border text-sm font-bold transition-all active:scale-[0.97] touch-manipulation select-none ${acceptedIndices.has(i) ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm' : 'border-emerald-200 bg-emerald-50 text-emerald-600'}`}>
                                ✓ Accept
                              </button>
                              <button onClick={() => {
                                const nextRej = new Set(unresolvedIndices);
                                nextRej.add(i);
                                setUnresolvedIndices(nextRej);
                                const nextAcc = new Set(acceptedIndices);
                                nextAcc.delete(i);
                                setAcceptedIndices(nextAcc);
                              }}
                                className={`flex-1 h-[44px] rounded-xl border text-sm font-bold transition-all active:scale-[0.97] touch-manipulation select-none ${unresolvedIndices.has(i) ? 'border-red-300 bg-red-100 text-red-800 shadow-sm' : 'border-red-200 bg-red-50 text-red-600'}`}>
                                ✕ Reject
                              </button>
                            </div>
                          ) : (
                            <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100 text-xs font-medium text-amber-700 flex items-center gap-2">
                              <AlertTriangle size={14} /> Site engineer has not uploaded evidence for this issue yet.
                            </div>
                          )}
                          {unresolvedIndices.has(i) && (
                            <div className="flex items-center gap-1.5"><AlertTriangle size={13} className="text-red-500" /><span className="text-xs font-semibold text-red-500">This issue will be sent for rework.</span></div>
                          )}
                          <button onClick={() => setCurrentIssueIndex(-1)}
                            className="w-full h-[38px] rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5">
                            <X size={15} /> Close
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Info Banner */}
            {!isReadOnly && (
              <div className="mx-4 mb-3 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
                <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-blue-700 leading-relaxed">Tap Review on any issue to inspect evidence. Accept all to approve the closure.</p>
              </div>
            )}
          </div>
          {/* Bottom Bar */}
          {!isReadOnly && (
            <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
              <button onClick={() => setReviewPage(2)}
                className="w-full h-[44px] rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm">
                Continue
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex-1 pb-28 overflow-y-auto animate-fade-in">
            {/* Accordion: Corrective Action Summary */}
            <div className="bg-white border-b border-slate-100">
              <button onClick={() => toggleSection('corrective')} className="w-full flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-800">Corrective Action Summary</h2>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{correctiveActions.length}</span>
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${expandedSections.corrective ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.corrective && (
                <div className="px-4 pb-3 space-y-2 animate-fade-in">
                  {correctiveActions.map((action: string, i: number) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-xs text-slate-700 leading-relaxed">{action.replace(/^\d+\.\s*/, '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Accordion: Submission Details */}
            <div className="bg-white border-b border-slate-100">
              <button onClick={() => toggleSection('submission')} className="w-full flex items-center justify-between px-4 py-3">
                <h2 className="text-sm font-bold text-slate-800">Submission Details</h2>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${expandedSections.submission ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.submission && (
                <div className="px-4 pb-3 space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-slate-500">Submitted By</span>
                    <span className="text-xs font-semibold text-slate-800">{item?.siteEngineer || dbItem?.site_engineer || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-slate-500">Submitted Date</span>
                    <span className="text-xs font-semibold text-slate-800">{closureDateTime}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-slate-500">Evidence Count</span>
                    <span className="text-xs font-semibold text-slate-800">{afterImages.filter(Boolean).length} of {issues.length}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Accordion: Timeline */}
            <div className="bg-white border-b border-slate-100">
              <button onClick={() => toggleSection('timeline')} className="w-full flex items-center justify-between px-4 py-3">
                <h2 className="text-sm font-bold text-slate-800">Timeline</h2>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${expandedSections.timeline ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.timeline && (
                <div className="px-4 pb-3 animate-fade-in">
                  <div className="relative pl-6 space-y-0">
                    {timelineSteps.map((step, i) => (
                      <div key={i} className="relative pb-4 last:pb-0">
                        {i < timelineSteps.length - 1 && <div className={`absolute left-[7px] top-[18px] w-0.5 h-[calc(100%-4px)] ${step.completed ? 'bg-blue-500' : 'bg-slate-200'}`} />}
                        <div className="flex items-start gap-3">
                          <div className={`w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${step.completed ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-white'}`}>
                            {step.completed && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-800">{step.label}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{step.detail}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Review Comments */}
            <div className="bg-white px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800 mb-1.5">Your Review {!isReadOnly && <span className="text-rose-500">*</span>}
              </h2>
              {!isReadOnly ? (
                <>
                  <SpeechTextarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value.slice(0, maxCommentLength))}
                    placeholder="Add your comments here..."
                    className="w-full h-[200px] resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400"
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-slate-400">{reviewComment.length} / {maxCommentLength}</span>
                    {!reviewComment.trim() && <span className="text-[11px] text-red-500 font-medium">Required</span>}
                  </div>
                </>
              ) : (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500 leading-relaxed">{reviewComment || 'No comments provided.'}</p>
                </div>
              )}
            </div>
            {/* Rejection Details (read-only) */}
            {isRejected && isReadOnly && (
              <div className="bg-white px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-800 mb-2">Rejection Details</h2>
                <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                  <p className="text-xs text-red-700 leading-relaxed">{dbItem?.initiator_comment || reviewComment || 'No rejection details provided.'}</p>
                </div>
              </div>
            )}
            {/* Final Decision */}
            <div className="bg-white px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800 mb-1">Final Decision</h2>
              <p className="text-[11px] text-slate-500 mb-3">Choose the final decision for this UAUC closure.</p>
              {isReadOnly ? (
                <div className={`p-3 rounded-xl border ${isApproved ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isApproved ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                      {isApproved ? <CheckCircle2 size={16} /> : <X size={16} />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{isApproved ? 'Approved' : 'Rejected'}</p>
                      <p className="text-xs text-slate-500">{isApproved ? 'Closure accepted.' : 'Closure rejected for rework.'}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <button onClick={() => !canApprove ? null : setFinalDecision(finalDecision === 'approve' ? null : 'approve')}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all active:scale-[0.98] touch-manipulation select-none ${finalDecision === 'approve' ? 'border-emerald-500 bg-emerald-100' : canApprove ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300' : 'border-slate-200 bg-white opacity-40 cursor-not-allowed'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${finalDecision === 'approve' ? 'bg-emerald-200 text-emerald-700' : 'bg-emerald-100 text-emerald-600'}`}>
                      <CheckCircle2 size={16} />
                    </div>
                    <div className="text-left flex-1">
                      <p className={`text-sm font-bold ${finalDecision === 'approve' ? 'text-emerald-900' : 'text-emerald-800'}`}>Approve Closure</p>
                      <p className={`text-xs ${finalDecision === 'approve' ? 'text-emerald-700' : 'text-emerald-600'}`}>I confirm that all issues have been resolved satisfactorily.</p>
                      {!canApprove && !hasUnresolved && <p className="text-[10px] text-red-500 mt-1 font-medium">Please add a review comment first.</p>}
                      {!canApprove && hasUnresolved && <p className="text-[10px] text-red-500 mt-1 font-medium">Reject unresolved issues before approving.</p>}
                    </div>
                  </button>
                  <button onClick={() => !canReject ? null : setFinalDecision(finalDecision === 'reject' ? null : 'reject')}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all active:scale-[0.98] touch-manipulation select-none ${finalDecision === 'reject' ? 'border-red-500 bg-red-100' : canReject ? 'border-red-200 bg-red-50/50 hover:border-red-300' : 'border-slate-200 bg-white opacity-40 cursor-not-allowed'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${finalDecision === 'reject' ? 'bg-red-200 text-red-700' : 'bg-red-100 text-red-600'}`}>
                      <X size={16} />
                    </div>
                    <div className="text-left flex-1">
                      <p className={`text-sm font-bold ${finalDecision === 'reject' ? 'text-red-900' : 'text-red-800'}`}>Reject &amp; Reassign</p>
                      <p className={`text-xs ${finalDecision === 'reject' ? 'text-red-700' : 'text-red-600'}`}>The corrective actions or evidence are not satisfactory.</p>
                      {!canReject && !hasUnresolved && <p className="text-[10px] text-red-500 mt-1 font-medium">Please reject at least one issue first.</p>}
                      {!canReject && hasUnresolved && !reviewComment.trim() && <p className="text-[10px] text-red-500 mt-1 font-medium">Please add a review comment first.</p>}
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* Fixed Bottom Bar */}
          {!isReadOnly && (
            <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
              <button onClick={() => {
                if (finalDecision === 'approve') setShowApproveConfirm(true);
                else if (finalDecision === 'reject') setShowRejectConfirm(true);
              }} disabled={!finalDecision || (finalDecision === 'approve' && !canApprove) || (finalDecision === 'reject' && !canReject)}
                className={`w-full h-[48px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors ${finalDecision === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : finalDecision === 'reject' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 text-white'}`}>
                {finalDecision === 'approve' ? <><CheckCircle2 size={16} /> Approve Closure</> : finalDecision === 'reject' ? <><X size={16} /> Reject &amp; Reassign</> : <>Select a Decision</>}
              </button>
              <button onClick={() => setReviewPage(1)} className="w-full text-center mt-2 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                Back to Issues
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});

// ─── SBG Dashboard ──────────────────────────────────────────────────────────
// Full rollup dashboard for SBG-role users: KPIs, Critical Activity Analysis,
// BU comparison, project summary, trends, and drill-down UAUC table.
// ---------------------------------------------------------------------------
const SBGDashboard = React.memo(function SBGDashboard({ user }: { user: { ps_number: string; role: string; name: string; mail_id: string; project_name: string } }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [compareFromDate, setCompareFromDate] = useState('');
  const [compareToDate, setCompareToDate] = useState('');
  const [compareFromDateB, setCompareFromDateB] = useState('');
  const [compareToDateB, setCompareToDateB] = useState('');
  const [selectedBU, setSelectedBU] = useState('All');
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [selectedActivity, setSelectedActivity] = useState('All');

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uaucs, setUaucs] = useState<any[]>([]);
  const [uaucsLoading, setUaucsLoading] = useState(false);
  const [showUAUCs, setShowUAUCs] = useState(false);

  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [allBUList, setAllBUList] = useState<string[]>([]);
  const [allActivityList, setAllActivityList] = useState<string[]>([]);
  const [projectCategoryMap, setProjectCategoryMap] = useState<Record<string, string>>({});

  const filteredProjects = useMemo(() => {
    const projects = selectedBU === 'All' ? allProjects : allProjects.filter(p => projectCategoryMap[p] === selectedBU);
    // Exclude BU category names from project dropdown
    const categoryNames = [...new Set(Object.values(projectCategoryMap))];
    return projects.filter(p => !categoryNames.includes(p));
  }, [allProjects, selectedBU, projectCategoryMap]);

  // Fetch independent dropdown lists on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/dashboard/projects').then(r => r.json()).catch(() => []),
      fetch('/api/dashboard/locations').then(r => r.json()).catch(() => []),
    ]).then(([projs, locs]) => {
      if (Array.isArray(projs) && projs.length) setAllProjects(projs);
      if (Array.isArray(locs) && locs.length) setAllLocations(locs);
    });
  }, []);

  // When BU changes, reset project to All
  useEffect(() => {
    setSelectedProject('All');
    setSelectedLocation('All');
    setSelectedActivity('All');
  }, [selectedBU]);

  // When project changes, refresh locations for that project
  useEffect(() => {
    if (selectedProject === 'All') {
      fetch('/api/dashboard/locations').then(r => r.json()).then(d => {
        if (Array.isArray(d)) setAllLocations(d);
      }).catch(() => {});
    } else {
      fetch(`/api/dashboard/locations?project=${encodeURIComponent(selectedProject)}`).then(r => r.json()).then(d => {
        if (Array.isArray(d)) setAllLocations(d);
      }).catch(() => {});
      setSelectedLocation('All');
    }
  }, [selectedProject]);

  const buildUrl = useCallback((base: string, extras?: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set('from_date', fromDate);
    params.set('to_date', toDate);
    if (compareFromDate) params.set('compare_from_date', compareFromDate);
    if (compareToDate) params.set('compare_to_date', compareToDate);
    if (compareFromDateB) params.set('compare_b_from_date', compareFromDateB);
    if (compareToDateB) params.set('compare_b_to_date', compareToDateB);
    if (selectedBU !== 'All') params.set('bu', selectedBU);
    if (selectedProject !== 'All') params.set('project', selectedProject);
    if (selectedLocation !== 'All') params.set('location', selectedLocation);
    if (selectedActivity !== 'All') params.set('activity', selectedActivity);
    if (extras) Object.entries(extras).forEach(([k, v]) => params.set(k, v));
    return `${base}?${params.toString()}`;
  }, [fromDate, toDate, compareFromDate, compareToDate, compareFromDateB, compareToDateB, selectedBU, selectedProject, selectedLocation, selectedActivity]);

  useEffect(() => {
    setLoading(true);
    fetch(buildUrl('/api/dashboard/sbg-rollup'))
      .then(r => r.json())
      .then(d => {
        setData(d);
        if (d.filters) {
          if (d.filters.bus?.length) setAllBUList(d.filters.bus);
          if (d.filters.activities_list?.length) setAllActivityList(d.filters.activities_list);
          if (d.filters.project_category_map) setProjectCategoryMap(d.filters.project_category_map);
          // Merge API projects/locations with independently fetched ones
          if (d.filters.projects?.length) setAllProjects(prev => {
            const merged = new Set([...prev, ...d.filters.projects]);
            return [...merged].sort();
          });
          if (d.filters.locations?.length) setAllLocations(prev => {
            if (selectedProject !== 'All') return d.filters.locations;
            const merged = new Set([...prev, ...d.filters.locations]);
            return [...merged].sort();
          });
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, selectedBU, selectedProject, selectedLocation, selectedActivity, buildUrl]);

  const loadUAUCs = useCallback(() => {
    setUaucsLoading(true);
    setShowUAUCs(true);
    fetch(buildUrl('/api/dashboard/uaucs', { limit: '200' }))
      .then(r => r.json())
      .then(d => setUaucs(Array.isArray(d) ? d : []))
      .catch(() => setUaucs([]))
      .finally(() => setUaucsLoading(false));
  }, [buildUrl]);



  const kpis = data?.kpis;
  const activities = data?.activities || [];
  const topSubActivity = data?.top_sub_activity || { name: '', total: 0 };
  const topSafetyIssue = data?.top_safety_issue || { name: '', total: 0 };
  const monthlyAvgCloseHours = data?.monthly_avg_close_hours || [];
  const topUnsafeAnalysis = data?.top_unsafe_analysis || '';
  const bus = data?.bus || [];
  const projects = data?.projects || [];
  const trend = data?.trend;
  const periodComparison = data?.period_comparison;

  const formatDate = (d: string | null) => {
    if (!d) return '--';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const statusColor = (s: string) => {
    const su = (s || '').toUpperCase();
    if (su === 'OPEN') return 'bg-blue-100 text-blue-700';
    if (su === 'AWAITING_APPROVAL') return 'bg-yellow-100 text-yellow-700';
    if (su === 'ACCEPTED' || su === 'CLOSED') return 'bg-emerald-100 text-emerald-700';
    if (su === 'REWORK_REQUIRED') return 'bg-orange-100 text-orange-700';
    if (su === 'REJECTED') return 'bg-rose-100 text-rose-700';
    if (su === 'OVERDUE') return 'bg-rose-100 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  };

  const trendIcon = (dir: string) => {
    if (dir === 'up') return <ArrowUp className="text-rose-500 rotate-0" size={14} />;
    if (dir === 'down') return <ArrowUp className="text-emerald-500 rotate-180" size={14} />;
    return <span className="text-slate-400">--</span>;
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={36} className="text-blue-500 animate-spin" />
        <span className="ml-3 text-slate-500 font-medium">Loading SBG Dashboard...</span>
      </div>
    );
  }

  const maxActivityCount = activities.length > 0 ? activities[0].total : 1;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header + Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">SBG Dashboard</h1>
            <p className="text-slate-500 text-sm">{data?.sbg_name || 'Strategic Business Group'} — UAUC rollup across all BUs and projects</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Clock size={12} />
            <span>{loading ? 'Refreshing...' : `Last updated: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}</span>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">BU</label>
            <select value={selectedBU} onChange={e => setSelectedBU(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
              <option value="All">All BUs</option>
              {[...new Set([...allBUList, 'Bridges', 'Roads & Runways'])].filter(b => b !== 'Unassigned').sort().map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</label>
            <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
              <option value="All">All Projects</option>
              {filteredProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Location</label>
            <select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
              <option value="All">All Locations</option>
              {allLocations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {allActivityList.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</label>
              <select value={selectedActivity} onChange={e => setSelectedActivity(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
                <option value="All">All Activities</option>
                {allActivityList.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* KPI Strip — 6 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total UAUCs', value: kpis?.total_uaucs ?? 0, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', icon: ClipboardCheck },
          { label: 'Open / In Progress', value: kpis?.open_uaucs ?? 0, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', icon: Clock },
          { label: 'Closed / Accepted', value: kpis?.closed_uaucs ?? 0, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: CheckCircle2 },
          { label: 'Overdue', value: kpis?.overdue_uaucs ?? 0, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100', icon: AlertTriangle },
          { label: 'Avg Close (hrs)', value: kpis?.avg_close_days ? Number((kpis.avg_close_days * 24).toFixed(1)) : 0, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-100', icon: Clock },
        ].map(({ label, value, color, bg, border, icon: Icon }) => (
          <div key={label} className={`p-4 ${bg} rounded-2xl border ${border} hover:shadow-md transition-all`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
              <Icon className={color} size={16} />
            </div>
            <p className={`text-2xl font-black ${color}`}>{value}</p>
          </div>
        ))}
        {/* Combined Day / Night Shift card */}
        <div className="p-4 bg-gradient-to-br from-sky-50 to-indigo-50 rounded-2xl border border-sky-100 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Day / Night</p>
            <Activity className="text-sky-600" size={16} />
          </div>
          <p className="text-2xl font-black text-sky-600">
            {kpis?.day_uaucs ?? 0}
            <span className="text-slate-400 mx-1">/</span>
            <span className="text-indigo-600">{kpis?.night_uaucs ?? 0}</span>
          </p>
        </div>
      </div>

      {/* Comparison Periods Bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
        {/* Period A inputs */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Period A (Compare)</label>
            <input type="date" value={compareFromDate} onChange={e => setCompareFromDate(e.target.value)}
              className="px-3 py-1.5 bg-white border border-blue-200 rounded-xl text-xs font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">To</label>
            <input type="date" value={compareToDate} onChange={e => setCompareToDate(e.target.value)}
              className="px-3 py-1.5 bg-white border border-blue-200 rounded-xl text-xs font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
          </div>
        </div>
        {/* Period B inputs */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Period B (Compare)</label>
            <input type="date" value={compareFromDateB} onChange={e => setCompareFromDateB(e.target.value)}
              className="px-3 py-1.5 bg-white border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">To</label>
            <input type="date" value={compareToDateB} onChange={e => setCompareToDateB(e.target.value)}
              className="px-3 py-1.5 bg-white border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm" />
          </div>
        </div>
        {/* Result: Period A vs Period B */}
        {(compareFromDate || compareFromDateB) && (
          <div className="flex items-center gap-4 flex-wrap pt-2 border-t border-slate-100">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                <span>Calculating...</span>
              </div>
            ) : periodComparison && (
              <>
                <div className="flex items-center gap-2 text-xs">
                  {trendIcon(periodComparison.direction)}
                  <span className="font-bold text-slate-700">
                    {periodComparison.direction === 'up' && `${Math.abs(periodComparison.change_pct)}% increase`}
                    {periodComparison.direction === 'down' && `${Math.abs(periodComparison.change_pct)}% decrease`}
                    {periodComparison.direction === 'flat' && 'No change'}
                    {periodComparison.direction === 'new' && 'New period (no prior data)'}
                    {periodComparison.direction === 'unknown' && 'Trend unavailable'}
                  </span>
                </div>
                <span className="text-slate-400 text-xs">
                  Period A: <span className="font-bold text-blue-600">{periodComparison.period_a_total}</span> | Period B: <span className="font-bold text-emerald-600">{periodComparison.period_b_total}</span>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Monthly average close time */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Month-wise Average Close Hours</p>
        <p className="text-xs text-slate-400 mb-3">Average time from UAUC observation to closure/acceptance</p>
        <div className="h-[260px]">
          {monthlyAvgCloseHours.length > 0 ? (
            <Suspense fallback={<div className="skeleton w-full h-full" />}>
              <MonthlyAvgCloseLineChart data={monthlyAvgCloseHours} />
            </Suspense>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">No closed UAUC data available</div>
          )}
        </div>
      </div>

      {/* ── Critical Activity Analysis ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Most Critical Activity hero card */}
        <div className="bg-gradient-to-br from-rose-50 to-orange-50 rounded-2xl border border-rose-100 p-6">
          <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mb-1">Most Critical Activity (SBG-wide)</p>
          {activities.length > 0 ? (
            <>
              <h3 className="text-xl font-black text-slate-900 mb-2">{activities[0].name}</h3>
              <div className="mb-3">
                <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">Most Frequent Sub Activity</p>
                <p className="text-sm font-bold text-slate-700">
                  {topSubActivity.name || 'Not recorded'}
                  {topSubActivity.total > 0 && <span className="text-xs font-semibold text-slate-400"> ({topSubActivity.total})</span>}
                </p>
              </div>
              <div className="mb-3">
                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Most Frequent Safety Issue</p>
                <p className="text-sm font-bold text-slate-700">
                  {topSafetyIssue.name || 'Not recorded'}
                  {topSafetyIssue.total > 0 && <span className="text-xs font-semibold text-slate-400"> ({topSafetyIssue.total})</span>}
                </p>
              </div>
              <p className="text-3xl font-black text-rose-600">{activities[0].total} <span className="text-sm font-bold text-slate-400">UAUCs</span></p>
              <p className="text-xs text-slate-500 mt-2">{kpis?.total_uaucs ? Math.round((activities[0].total / kpis.total_uaucs) * 100) : 0}% of all UAUCs in selected period</p>
              <div className="flex items-center gap-4 mt-3 text-xs">
                <span className="text-sky-600 font-bold">Day: {activities[0].day}</span>
                <span className="text-purple-800 font-bold">Night: {activities[0].night}</span>
              </div>
              {topUnsafeAnalysis && (
                <div className="mt-4 p-3 bg-white/60 rounded-xl border border-rose-100">
                  <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">Most Frequent Unsafe Activity</p>
                  <p className="text-xs text-slate-700 leading-relaxed">{topUnsafeAnalysis}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">No activity data available</p>
          )}
        </div>

        {/* Day vs Night Distribution (horizontal bars for top 10) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Day vs Night Distribution — Top Activities</p>
          <div className="space-y-2.5">
            {activities.map((act: any, i: number) => {
              const dayPct = act.total > 0 ? (act.day / act.total) * 100 : 0;
              return (
                <div key={i} className="group">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">{act.name}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{act.total}</span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                    <div className="h-full bg-sky-400 rounded-l-full transition-all" style={{ width: `${dayPct}%` }} title={`Day: ${act.day}`} />
                    <div className="h-full bg-purple-800 rounded-r-full transition-all" style={{ width: `${100 - dayPct}%` }} title={`Night: ${act.night}`} />
                  </div>
                </div>
              );
            })}
          </div>
<div className="flex items-center gap-4 mt-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-sky-400 inline-block" /> Day (06:00–18:00)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-purple-800 inline-block" /> Night (18:00–06:00)</span>
          </div>
        </div>
      </div>

      {/* Ranked Activities Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Top Activities — SBG-wide Ranking</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">#</th>
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Total</th>
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Day</th>
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Night</th>
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {activities.map((act: any, i: number) => {
                const barWidth = maxActivityCount > 0 ? (act.total / maxActivityCount) * 100 : 0;
                const dayPct = act.total > 0 ? (act.day / act.total) * 100 : 0;
                return (
                  <tr key={i}
                    className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs font-bold text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-900">{act.name}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-900 text-right">{act.total}</td>
                    <td className="px-4 py-3 text-xs text-sky-600 font-semibold text-right">{act.day}</td>
                    <td className="px-4 py-3 text-xs text-purple-800 font-semibold text-right">{act.night}</td>
                    <td className="px-4 py-3">
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex max-w-[200px]">
                        <div className="h-full bg-sky-400 rounded-l-full" style={{ width: `${dayPct}%` }} />
                        <div className="h-full bg-purple-800 rounded-r-full" style={{ width: `${100 - dayPct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Daily Trend Chart (simple bar visualization) ────────── */}
      {trend?.daily?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">UAUC Trend</p>
          <div className="flex gap-2">
            {/* Y-axis labels */}
            <div className="flex flex-col items-end justify-between h-56 w-12 pr-2 text-right">
              {(() => {
                const maxDay = Math.max(...trend.daily.map((x: any) => x.total), 1);
                const steps = 5;
                return Array.from({ length: steps + 1 }, (_, i) => {
                  const val = Math.round((maxDay / steps) * (steps - i));
                  return (
                    <div key={i} className="text-[9px] text-slate-400 w-full" style={{ height: `${100 / steps}%` }}>
                      <span>{val}</span>
                    </div>
                  );
                });
              })()}
            </div>
{/* Chart */}
            <div className="flex-1 flex gap-2 h-56 overflow-x-auto pb-4 relative">
              {trend.daily.map((d: any, i: number) => {
                const maxDay = Math.max(...trend.daily.map((x: any) => x.total), 1);
                const h = (d.total / maxDay) * 100;
                return (
                  <div key={i} className="flex flex-col items-center flex-shrink-0" style={{ minWidth: '24px', height: '100%' }}>
                    <div className="flex-1 flex items-end w-full">
                      <div className="w-full relative bg-blue-500 rounded-t-sm" style={{ height: `${h}%`, minHeight: h > 0 ? '3px' : '0' }} title={`Total: ${d.total}`}>
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full text-[9px] font-bold text-slate-700 pb-0.5 whitespace-nowrap">{d.total}</div>
                      </div>
                    </div>
                    <span className="text-[9px] text-slate-500 mt-1 whitespace-nowrap">{d.date?.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400 ml-12">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Total UAUCs</span>
          </div>
        </div>
      )}

      {/* ── BU Comparison ──────────────────────────────────────── */}
      {bus.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* BU bar chart */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">BU-level UAUC Volume</p>
            <div className="space-y-3">
              {bus.map((b: any, i: number) => {
                const maxBU = bus.length > 0 ? bus[0].total_uaucs : 1;
                const w = maxBU > 0 ? (b.total_uaucs / maxBU) * 100 : 0;
                return (
                  <div key={i} className="group">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">{b.name}</span>
                      <span className="text-[10px] text-slate-400 ml-auto font-bold">{b.total_uaucs}</span>
                    </div>
                    <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex">
                      <div className="h-full bg-blue-400 rounded-l-full transition-all group-hover:bg-blue-500" style={{ width: `${w * (1 - b.overdue / Math.max(b.total_uaucs, 1))}%` }} />
                      <div className="h-full bg-rose-400 transition-all" style={{ width: `${w * (b.overdue / Math.max(b.total_uaucs, 1))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Normal</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> Overdue</span>
            </div>
          </div>

          {/* BU summary table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">BU Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">BU</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Total</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Open</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Overdue</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Top Activity</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Day%</th>
                    <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Night%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {bus.map((b: any, i: number) => (
                    <tr key={i}
                      className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2 text-xs font-bold text-slate-900">{b.name}</td>
                      <td className="px-3 py-2 text-xs font-bold text-slate-900 text-right">{b.total_uaucs}</td>
                      <td className="px-3 py-2 text-xs text-amber-600 font-semibold text-right">{b.open}</td>
                      <td className="px-3 py-2 text-xs text-rose-600 font-semibold text-right">{b.overdue}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 truncate max-w-[120px]">{b.top_activity}</td>
                      <td className="px-3 py-2 text-xs text-sky-600 text-right">{b.day_pct}%</td>
                      <td className="px-3 py-2 text-xs text-purple-800 text-right">{b.night_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Project Summary Table ───────────────────────────────── */}
      {projects.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Projects</h2>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">BU</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Total</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Open</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Overdue</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Top Activity</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Locations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {projects.map((p: any, i: number) => (
                  <tr key={i}
                    className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs font-bold text-blue-600">{p.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{p.bu}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-900 text-right">{p.total_uaucs}</td>
                    <td className="px-4 py-3 text-xs text-amber-600 font-semibold text-right">{p.open}</td>
                    <td className="px-4 py-3 text-xs text-rose-600 font-semibold text-right">{p.overdue}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 truncate max-w-[150px]">{p.top_activity}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 text-right">{p.locations_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── UAUC Detail Table (collapsible) ─────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <button onClick={() => { if (!showUAUCs) loadUAUCs(); else setShowUAUCs(false); }}
          className="w-full p-4 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
          <div className="text-left">
            <h2 className="text-lg font-bold text-slate-900">UAUC Records</h2>
            <p className="text-xs text-slate-400">{showUAUCs ? `${uaucs.length} records loaded` : 'Click to expand and view individual records'}</p>
          </div>
          <ChevronDown size={20} className={`text-slate-400 transition-transform ${showUAUCs ? 'rotate-180' : ''}`} />
        </button>
        {showUAUCs && (
          <div>
            {uaucsLoading ? (
              <div className="p-12 text-center">
                <Loader2 size={32} className="mx-auto text-blue-500 animate-spin mb-3" />
                <p className="text-sm text-slate-500">Loading UAUC records...</p>
              </div>
            ) : uaucs.length === 0 ? (
              <div className="p-12 text-center">
                <Database size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-bold text-slate-900 mb-2">No UAUCs Found</h3>
                <p className="text-slate-500 text-sm">No records match the current filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Audit ID</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Site Engineer</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Obs. Date</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Obs. Time</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Shift</th>
<th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                       <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Closed Date</th>
                       <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Safety Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {uaucs.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors align-top">
                        <td className="px-3 py-2 text-xs font-mono font-medium text-blue-600 whitespace-nowrap">{item.audit_id}</td>
                        <td className="px-3 py-2 text-xs font-medium text-slate-900">{item.activity || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.project || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.location || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.site_engineer || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.observation_date)}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{item.observation_time || '--'}</td>
<td className="px-3 py-2">
                           <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${item.shift === 'Day' ? 'bg-sky-100 text-sky-700' : item.shift === 'Night' ? 'bg-purple-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
                             {item.shift}
                           </span>
                         </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColor(item.status)}`}>
                            {item.status || 'OPEN'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.closed_date)}</td>
                        <td className="px-3 py-2 max-w-[200px] text-xs text-slate-600 truncate">{item.safety_issues || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
});

// ─── Site Engineer Dashboard ─────────────────────────────────────────────────
// Personalised dashboard for site engineers — shows only their own UAUC data.
// ---------------------------------------------------------------------------
const SiteEngineerDashboard = React.memo(function SiteEngineerDashboard({ user }: { user: { ps_number: string; role: string; name: string; mail_id: string; project_name: string } }) {
  const [uaucs, setUaucs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ engineer: user.name, limit: '100' });
    authFetch(`/api/uaucs/my?${params.toString()}`)
      .then(r => {
        if (!r.ok) return r.text().then(t => { try { const j = JSON.parse(t); throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail || j)); } catch (e: any) { throw e.message ? e : new Error(`HTTP ${r.status}`); } });
        return r.json();
      })
      .then(d => setUaucs(d.items || []))
      .catch(e => { console.error('UAUC fetch error:', e); setError(e.message); setUaucs([]); })
      .finally(() => setLoading(false));
  }, [user.name]);

  const openCount = uaucs.filter(u => ['OPEN', 'AWAITING_APPROVAL', 'REWORK_REQUIRED'].includes((u.status || '').toUpperCase())).length;
  const closedCount = uaucs.filter(u => ['ACCEPTED', 'CLOSED'].includes((u.status || '').toUpperCase())).length;
  const overdueCount = uaucs.filter(u => (u.status || '').toUpperCase() === 'OVERDUE').length;

  const [urgentFilter, setUrgentFilter] = useState('all');
  const [showUAUCs, setShowUAUCs] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  const rankedUaucs = useMemo(() => {
    let list = [...uaucs];
    if (urgentFilter !== 'all') {
      list = list.filter(u => (u.status || '').toUpperCase() === urgentFilter.toUpperCase());
    }
    const urgencyScore = (u: any) => {
      const st = (u.status || '').toUpperCase();
      const isOverdue = st === 'OVERDUE' || (u.target_date && u.target_date < todayStr && !['CLOSED', 'ACCEPTED', 'REJECTED'].includes(st));
      if (isOverdue) {
        const daysOverdue = u.target_date
          ? Math.floor((Date.now() - new Date(u.target_date).getTime()) / (1000 * 60 * 60 * 24))
          : 9999;
        return -daysOverdue;
      }
      if (st === 'OPEN' || st === 'REWORK_REQUIRED') {
        if (u.target_date) {
          const daysLeft = Math.ceil((new Date(u.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return daysLeft;
        }
        return 9999;
      }
      if (st === 'AWAITING_APPROVAL') return 50000;
      return 99999;
    };
    list.sort((a: any, b: any) => urgencyScore(a) - urgencyScore(b));
    return list;
  }, [uaucs, urgentFilter, todayStr]);

  const projectLocationMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    uaucs.forEach(u => {
      const p = u.project || 'Unknown';
      if (!map[p]) map[p] = new Set();
      if (u.location) map[p].add(u.location);
    });
    return Object.entries(map).map(([project, locs]) => ({ project, locations: [...locs].sort() })).sort((a, b) => b.locations.length - a.locations.length);
  }, [uaucs]);

  const allLocations = useMemo(() => [...new Set(uaucs.map(u => u.location).filter(Boolean))].sort(), [uaucs]);

  const classifyShift = (u: any): string => {
    if (u.shift === 'Day' || u.shift === 'Night') return u.shift;
    if (u.observation_time) {
      try {
        const parts = u.observation_time.trim().split(/\s+/);
        const timePart = parts[parts.length - 1];
        const h = parseInt(timePart.split(':')[0], 10);
        if (!isNaN(h)) return h >= 6 && h < 18 ? 'Day' : 'Night';
      } catch {}
    }
    return 'Unknown';
  };

  const activitySummary = useMemo(() => {
    const map: Record<string, { count: number; day: number; night: number; projects: Set<string>; locations: Set<string> }> = {};
    uaucs.forEach(u => {
      const a = u.activity || 'Unknown';
      if (!map[a]) map[a] = { count: 0, day: 0, night: 0, projects: new Set(), locations: new Set() };
      map[a].count++;
      const shift = classifyShift(u);
      if (shift === 'Day') map[a].day++;
      else if (shift === 'Night') map[a].night++;
      if (u.project) map[a].projects.add(u.project);
      if (u.location) map[a].locations.add(u.location);
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d, projects: [...d.projects], locations: [...d.locations] }))
      .sort((a, b) => b.count - a.count);
  }, [uaucs]);

  const topSubActivity = useMemo(() => {
    const topAct = activitySummary[0];
    if (!topAct) return { name: '', total: 0 };
    const freq: Record<string, number> = {};
    uaucs.forEach(u => {
      if ((u.activity || 'Unknown') !== topAct.name) return;
      const raw = u.sub_activity || '';
      raw.split(/[;\n]/).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => { freq[s] = (freq[s] || 0) + 1; });
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? { name: sorted[0][0], total: sorted[0][1] } : { name: '', total: 0 };
  }, [uaucs, activitySummary]);

  const topSafetyIssue = useMemo(() => {
    const topAct = activitySummary[0];
    if (!topAct) return { name: '', total: 0 };
    const freq: Record<string, number> = {};
    uaucs.forEach(u => {
      if ((u.activity || 'Unknown') !== topAct.name) return;
      const raw = u.safety_issues_text || (Array.isArray(u.safety_issues) ? u.safety_issues.join(';') : '');
      raw.split(/[;\n]/).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => { freq[s] = (freq[s] || 0) + 1; });
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? { name: sorted[0][0], total: sorted[0][1] } : { name: '', total: 0 };
  }, [uaucs, activitySummary]);

  const topUnsafeActivity = useMemo(() => {
    const topAct = activitySummary[0];
    if (!topAct) return '';
    const freq: Record<string, number> = {};
    uaucs.forEach(u => {
      if ((u.activity || 'Unknown') !== topAct.name) return;
      const raw = u.safety_issues_text || (Array.isArray(u.safety_issues) ? u.safety_issues.join(';') : '');
      raw.split(/[;\n]/).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => { freq[s] = (freq[s] || 0) + 1; });
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (sorted.length === 0) return '';
    return sorted.map(([name, count]) => `${name} (${count})`).join('; ');
  }, [uaucs, activitySummary]);

  const formatDate = (d: string | null) => {
    if (!d) return '--';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const statusColor = (s: string) => {
    const su = (s || '').toUpperCase();
    if (su === 'OPEN') return 'bg-blue-100 text-blue-700';
    if (su === 'AWAITING_APPROVAL') return 'bg-yellow-100 text-yellow-700';
    if (su === 'ACCEPTED' || su === 'CLOSED') return 'bg-emerald-100 text-emerald-700';
    if (su === 'REWORK_REQUIRED') return 'bg-orange-100 text-orange-700';
    if (su === 'REJECTED') return 'bg-rose-100 text-rose-700';
    if (su === 'OVERDUE') return 'bg-rose-100 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting}, {user.name.split(' ')[0]}</h1>
          <p className="text-slate-500 text-sm">Your personal safety dashboard</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Clock size={12} />
          <span>{loading ? 'Refreshing...' : `Last updated: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}</span>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm font-semibold">
          Failed to load UAUC records: {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total UAUCs', value: uaucs.length, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', icon: ClipboardCheck },
          { label: 'Open / In Progress', value: openCount, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', icon: Clock },
          { label: 'Closed / Accepted', value: closedCount, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: CheckCircle2 },
          { label: 'Overdue', value: overdueCount, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100', icon: AlertTriangle },
        ].map(({ label, value, color, bg, border, icon: Icon }) => (
          <div key={label} className={`p-4 ${bg} rounded-2xl border ${border} hover:shadow-md transition-all`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
              <Icon className={color} size={16} />
            </div>
            <p className={`text-2xl font-black ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Projects & Locations + Critical Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Projects & Locations */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">My Projects &amp; Locations</p>
          {projectLocationMap.length > 0 ? (
            <div className="space-y-3 max-h-[280px] overflow-y-auto">
              {projectLocationMap.map((p, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-bold text-slate-900">{p.project}</span>
                    <span className="text-[10px] font-bold text-slate-400">{p.locations.length} location{p.locations.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {p.locations.map((loc, j) => (
                      <span key={j} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-semibold w-fit">{j + 1}. {loc}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No project data available</p>
          )}
        </div>

        {/* Most Critical Activity */}
        <div className="bg-gradient-to-br from-rose-50 to-orange-50 rounded-2xl border border-rose-100 p-6">
          <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mb-1">Most Critical Activity</p>
          {activitySummary.length > 0 ? (
            <>
              <h3 className="text-xl font-black text-slate-900 mb-2">{activitySummary[0].name}</h3>
              <div className="mb-3">
                <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">Most Frequent Sub Activity</p>
                <p className="text-sm font-bold text-slate-700">
                  {topSubActivity.name || 'Not recorded'}
                  {topSubActivity.total > 0 && <span className="text-xs font-semibold text-slate-400"> ({topSubActivity.total})</span>}
                </p>
              </div>
              <div className="mb-3">
                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Most Frequent Safety Issue</p>
                <p className="text-sm font-bold text-slate-700">
                  {topSafetyIssue.name || 'Not recorded'}
                  {topSafetyIssue.total > 0 && <span className="text-xs font-semibold text-slate-400"> ({topSafetyIssue.total})</span>}
                </p>
              </div>
              <p className="text-3xl font-black text-rose-600">{activitySummary[0].count} <span className="text-sm font-bold text-slate-400">UAUCs</span></p>
              <p className="text-xs text-slate-500 mt-2">{((activitySummary[0].count / Math.max(uaucs.length, 1)) * 100).toFixed(1)}% of your total UAUCs</p>
              <div className="flex items-center gap-4 mt-3 text-xs">
                <span className="text-sky-600 font-bold">Day: {activitySummary[0].day}</span>
                <span className="text-purple-800 font-bold">Night: {activitySummary[0].night}</span>
              </div>
              {topUnsafeActivity && (
                <div className="mt-4 p-3 bg-white/60 rounded-xl border border-rose-100">
                  <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">Most Frequent Unsafe Activity</p>
                  <p className="text-xs text-slate-700 leading-relaxed">{topUnsafeActivity}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">No activity data available</p>
          )}
        </div>
      </div>

      {/* Needs Urgent Attention — full width */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Needs Urgent Attention</p>
            <p className="text-xs text-slate-400 mt-0.5">Overdue items shown first, then by nearest target date</p>
          </div>
          <select
            value={urgentFilter}
            onChange={e => setUrgentFilter(e.target.value)}
            className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="all">All Status</option>
            <option value="OPEN">Open</option>
            <option value="OVERDUE">Overdue</option>
            <option value="AWAITING_APPROVAL">Awaiting Approval</option>
            <option value="REWORK_REQUIRED">Rework Required</option>
            <option value="CLOSED">Closed</option>
            <option value="ACCEPTED">Accepted</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[320px] space-y-2">
          {rankedUaucs.length > 0 ? rankedUaucs.map((u, i) => {
            const st = (u.status || '').toUpperCase();
            const isOverdue = u.target_date && u.target_date < todayStr && !['CLOSED', 'ACCEPTED', 'REJECTED'].includes(st);
            const daysLeft = u.target_date ? Math.ceil((new Date(u.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
            const badgeClass = isOverdue
              ? 'bg-red-100 text-red-700 border-red-200'
              : st === 'OPEN' || st === 'REWORK_REQUIRED'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : st === 'AWAITING_APPROVAL'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200';
            return (
              <div key={u.id || i} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                  {u.has_image && u.image_url ? (
                    <img src={u.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Camera size={14} className="text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-600 font-mono">{u.audit_id}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${badgeClass}`}>
                      {isOverdue ? 'OVERDUE' : u.status || 'OPEN'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{u.location || '--'}</p>
                  <p className="text-[11px] text-slate-400 truncate">{u.safety_issues_text || 'No issues recorded'}</p>
                </div>
                <div className="text-right shrink-0">
                  {u.target_date ? (
                    <p className={`text-[11px] font-bold ${isOverdue ? 'text-red-600' : daysLeft !== null && daysLeft <= 3 ? 'text-amber-600' : 'text-slate-600'}`}>
                      {u.target_date}
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400">No target</p>
                  )}
                  {daysLeft !== null && (
                    <p className={`text-[9px] font-bold ${isOverdue ? 'text-red-500' : daysLeft <= 3 ? 'text-amber-500' : 'text-slate-400'}`}>
                      {isOverdue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`}
                    </p>
                  )}
                </div>
              </div>
            );
          }) : (
            <div className="p-6 text-center">
              <CheckCircle2 size={28} className="mx-auto text-emerald-300 mb-2" />
              <p className="text-sm text-slate-400 font-semibold">All clear! No urgent items.</p>
            </div>
          )}
        </div>
      </div>

      {/* Ranked Activities Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Activities — Ranked</h2>
          <p className="text-xs text-slate-400">Your activities ranked by UAUC count with project and location details</p>
        </div>
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 size={32} className="mx-auto text-blue-500 animate-spin mb-3" />
            <p className="text-sm text-slate-500">Loading your data...</p>
          </div>
        ) : activitySummary.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Total</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Day</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Night</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Projects</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Locations</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-32">Distribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activitySummary.map((act, i) => {
                  const barWidth = activitySummary[0]?.count > 0 ? (act.count / activitySummary[0].count) * 100 : 0;
                  const dayPct = act.count > 0 ? (act.day / act.count) * 100 : 0;
                  return (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-xs font-bold text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-900">{act.name}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-900 text-right">{act.count}</td>
                      <td className="px-4 py-3 text-xs text-sky-600 font-semibold text-right">{act.day}</td>
                      <td className="px-4 py-3 text-xs text-purple-800 font-semibold text-right">{act.night}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {act.projects.map((p: string, j: number) => (
                            <span key={j} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-semibold">{p}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {act.locations.map((l: string, j: number) => (
                            <span key={j} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold">{l}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex max-w-[120px]">
                          <div className="h-full bg-sky-400 rounded-l-full" style={{ width: `${dayPct}%` }} />
                          <div className="h-full bg-purple-800 rounded-r-full" style={{ width: `${100 - dayPct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center">
            <Database size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Records Found</h3>
            <p className="text-slate-500 text-sm">No UAUC records are assigned to you yet.</p>
          </div>
        )}
      </div>

      {/* Day vs Night Distribution */}
      {activitySummary.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Day vs Night Distribution</p>
          <div className="space-y-2.5">
            {activitySummary.map((act, i) => {
              const dayPct = act.count > 0 ? (act.day / act.count) * 100 : 0;
              return (
                <div key={i} className="group">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">{act.name}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{act.count}</span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                    <div className="h-full bg-sky-400 rounded-l-full transition-all" style={{ width: `${dayPct}%` }} title={`Day: ${act.day}`} />
                    <div className="h-full bg-purple-800 rounded-r-full transition-all" style={{ width: `${100 - dayPct}%` }} title={`Night: ${act.night}`} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-sky-400 inline-block" /> Day (06:00–18:00)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-purple-800 inline-block" /> Night (18:00–06:00)</span>
          </div>
        </div>
      )}

      {/* ── UAUC Records Table (collapsible) ─────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <button onClick={() => setShowUAUCs(!showUAUCs)}
          className="w-full p-4 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
          <div className="text-left">
            <h2 className="text-lg font-bold text-slate-900">UAUC Records</h2>
            <p className="text-xs text-slate-400">{showUAUCs ? `${uaucs.length} records loaded` : 'Click to expand and view your records'}</p>
          </div>
          <ChevronDown size={20} className={`text-slate-400 transition-transform ${showUAUCs ? 'rotate-180' : ''}`} />
        </button>
        {showUAUCs && (
          <div>
            {loading ? (
              <div className="p-12 text-center">
                <Loader2 size={32} className="mx-auto text-blue-500 animate-spin mb-3" />
                <p className="text-sm text-slate-500">Loading UAUC records...</p>
              </div>
            ) : uaucs.length === 0 ? (
              <div className="p-12 text-center">
                <Database size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-bold text-slate-900 mb-2">No UAUCs Found</h3>
                <p className="text-slate-500 text-sm">No records assigned to you yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Audit ID</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Site Engineer</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Obs. Date</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Obs. Time</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Shift</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Closed Date</th>
                      <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Safety Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {uaucs.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors align-top">
                        <td className="px-3 py-2 text-xs font-mono font-medium text-blue-600 whitespace-nowrap">{item.audit_id}</td>
                        <td className="px-3 py-2 text-xs font-medium text-slate-900">{item.activity || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.project || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.location || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.site_engineer || '--'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.observation_date)}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{item.observation_time || '--'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${classifyShift(item) === 'Day' ? 'bg-sky-100 text-sky-700' : classifyShift(item) === 'Night' ? 'bg-purple-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            {classifyShift(item)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColor(item.status)}`}>
                            {item.status || 'OPEN'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.closed_date)}</td>
                        <td className="px-3 py-2 max-w-[200px] text-xs text-slate-600 truncate">{item.safety_issues || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Individual Dashboard ─────────────────────────────────────────────────────
// Individual UAUC records view with the same filters as SBG Dashboard.
// ---------------------------------------------------------------------------
const IndividualDashboard = React.memo(function IndividualDashboard({ user }: { user: { ps_number: string; role: string; name: string; mail_id: string; project_name: string } }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [selectedBU, setSelectedBU] = useState('All');
  const [selectedProject, setSelectedProject] = useState('All');
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [selectedActivity, setSelectedActivity] = useState('All');

  const [uaucs, setUaucs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [allBUList, setAllBUList] = useState<string[]>([]);
  const [allActivityList, setAllActivityList] = useState<string[]>([]);
  const [showAllCriticalEngineers, setShowAllCriticalEngineers] = useState(false);
  const [selectedEngineer, setSelectedEngineer] = useState<string | null>(null);
  const [selectedActivityDetail, setSelectedActivityDetail] = useState<string | null>(null);

  const PROJECT_CATEGORY_MAP: Record<string, string> = useMemo(() => ({
    Bridges: 'Bridges', MVDP: 'Bridges', MDLRP: 'Bridges', SIGS: 'Bridges', KDBP: 'Bridges',
    MRBP: 'Bridges', MSBP: 'Bridges',
    'Roads & Runways': 'Roads & Runways', MADP: 'Roads & Runways', 'MPRRP 03': 'Roads & Runways', MHRP: 'Roads & Runways',
    'MLRP-1': 'Roads & Runways', 'MLRP-2': 'Roads & Runways', 'MLRP-3': 'Roads & Runways',
    NMIAL: 'Roads & Runways', MVIAL: 'Roads & Runways', MHGEP: 'Roads & Runways', MRFP: 'Roads & Runways', MPSB: 'Roads & Runways',
  }), []);

  const BU_CATEGORIES = useMemo(() => ['Bridges', 'Roads & Runways'], []);
  const filteredProjects = useMemo(() => {
    const projects = selectedBU === 'All' ? allProjects : allProjects.filter(p => PROJECT_CATEGORY_MAP[p] === selectedBU);
    return projects.filter(p => !BU_CATEGORIES.includes(p));
  }, [allProjects, selectedBU, PROJECT_CATEGORY_MAP, BU_CATEGORIES]);

  useEffect(() => {
    Promise.all([
      authFetch('/api/dashboard/projects')
        .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`); }); return r.json(); })
        .catch(e => { console.error('Failed to load projects:', e); return []; }),
      authFetch('/api/dashboard/locations')
        .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`); }); return r.json(); })
        .catch(e => { console.error('Failed to load locations:', e); return []; }),
    ]).then(([projs, locs]) => {
      if (Array.isArray(projs) && projs.length) setAllProjects(projs);
      if (Array.isArray(locs) && locs.length) setAllLocations(locs);
    });
  }, []);

  useEffect(() => {
    setSelectedProject('All');
    setSelectedLocation('All');
    setSelectedActivity('All');
  }, [selectedBU]);

  useEffect(() => {
    if (selectedProject === 'All') {
      authFetch('/api/dashboard/locations')
        .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`); }); return r.json(); })
        .then(d => { if (Array.isArray(d)) setAllLocations(d); })
        .catch(e => { console.error('Failed to load locations:', e); });
    } else {
      authFetch(`/api/dashboard/locations?project=${encodeURIComponent(selectedProject)}`)
        .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`); }); return r.json(); })
        .then(d => { if (Array.isArray(d)) setAllLocations(d); })
        .catch(e => { console.error('Failed to load filtered locations:', e); });
      setSelectedLocation('All');
    }
  }, [selectedProject]);

  const buildUrl = useCallback((base: string) => {
    const params = new URLSearchParams();
    params.set('from_date', fromDate);
    params.set('to_date', toDate);
    if (selectedBU !== 'All') params.set('bu', selectedBU);
    if (selectedProject !== 'All') params.set('project', selectedProject);
    if (selectedLocation !== 'All') params.set('location', selectedLocation);
    if (selectedActivity !== 'All') params.set('activity', selectedActivity);
    return `${base}?${params.toString()}`;
  }, [fromDate, toDate, selectedBU, selectedProject, selectedLocation, selectedActivity]);

  useEffect(() => {
    setLoading(true);
    authFetch(buildUrl('/api/dashboard/uaucs'))
      .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`); }); return r.json(); })
      .then(d => { if (Array.isArray(d)) setUaucs(d); else setUaucs([]); })
      .catch(() => setUaucs([]))
      .finally(() => setLoading(false));
  }, [buildUrl]);

  useEffect(() => {
    authFetch(buildUrl('/api/dashboard/sbg-rollup'))
      .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || `HTTP ${r.status}`); }); return r.json(); })
      .then(d => {
        if (d?.filters) {
          if (d.filters.bus?.length) setAllBUList(d.filters.bus);
          if (d.filters.activities_list?.length) setAllActivityList(d.filters.activities_list);
          if (d.filters.projects?.length) setAllProjects(prev => {
            const merged = new Set([...prev, ...d.filters.projects]);
            return [...merged].sort();
          });
          if (d.filters.locations?.length) setAllLocations(prev => {
            if (selectedProject !== 'All') return d.filters.locations;
            const merged = new Set([...prev, ...d.filters.locations]);
            return [...merged].sort();
          });
        }
      })
      .catch(() => {});
  }, [fromDate, toDate, selectedBU, selectedProject, selectedLocation, selectedActivity]);

  const openCount = uaucs.filter(u => ['OPEN', 'AWAITING_APPROVAL', 'REWORK_REQUIRED'].includes((u.status || '').toUpperCase())).length;
  const closedCount = uaucs.filter(u => ['CLOSED', 'ACCEPTED'].includes((u.status || '').toUpperCase())).length;
  const overdueCount = uaucs.filter(u => (u.status || '').toUpperCase() === 'OVERDUE').length;
  const dayCount = uaucs.filter(u => u.shift === 'Day').length;
  const nightCount = uaucs.filter(u => u.shift === 'Night').length;

  const activitySummary = useMemo(() => {
    const map: Record<string, number> = {};
    uaucs.forEach(u => { const a = u.activity || 'Unknown'; map[a] = (map[a] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [uaucs]);

  const mostCriticalActivity = activitySummary.length > 0 ? activitySummary[0] : null;

  const topEngineersForCritical = useMemo(() => {
    if (!mostCriticalActivity) return [];
    const engMap: Record<string, number> = {};
    uaucs.forEach(u => {
      if ((u.activity || 'Unknown') === mostCriticalActivity.name) {
        const e = u.site_engineer || 'Unknown';
        engMap[e] = (engMap[e] || 0) + 1;
      }
    });
    return Object.entries(engMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [uaucs, mostCriticalActivity]);

  const top5CriticalEngineers = topEngineersForCritical.slice(0, 5);
  const restCriticalEngineers = topEngineersForCritical.slice(5);

  const engineerSummary = useMemo(() => {
    const map: Record<string, number> = {};
    uaucs.forEach(u => { const e = u.site_engineer || 'Unknown'; map[e] = (map[e] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [uaucs]);

  const engineerDetail = useMemo(() => {
    if (!selectedEngineer) return null;
    const engineerUaucs = uaucs.filter(u => (u.site_engineer || 'Unknown') === selectedEngineer);
    const total = engineerUaucs.length;
    const openCount = engineerUaucs.filter(u => ['OPEN', 'AWAITING_APPROVAL', 'REWORK_REQUIRED'].includes((u.status || '').toUpperCase())).length;
    const closedCount = engineerUaucs.filter(u => ['CLOSED', 'ACCEPTED'].includes((u.status || '').toUpperCase())).length;
    const overdueCount = engineerUaucs.filter(u => (u.status || '').toUpperCase() === 'OVERDUE').length;

    const projectMap: Record<string, { total: number; open: number; closed: number; overdue: number; locations: Record<string, { total: number; open: number; closed: number; overdue: number; activities: Record<string, number> }> }> = {};
    engineerUaucs.forEach(u => {
      const proj = u.project || 'Unknown';
      const loc = u.location || 'Unknown';
      const act = u.activity || 'Unknown';
      const su = (u.status || 'OPEN').toUpperCase();
      const isOpen = ['OPEN', 'AWAITING_APPROVAL', 'REWORK_REQUIRED'].includes(su);
      const isClosed = ['CLOSED', 'ACCEPTED'].includes(su);
      const isOverdue = su === 'OVERDUE';
      if (!projectMap[proj]) projectMap[proj] = { total: 0, open: 0, closed: 0, overdue: 0, locations: {} };
      projectMap[proj].total++;
      if (isOpen) projectMap[proj].open++;
      if (isClosed) projectMap[proj].closed++;
      if (isOverdue) projectMap[proj].overdue++;
      if (!projectMap[proj].locations[loc]) projectMap[proj].locations[loc] = { total: 0, open: 0, closed: 0, overdue: 0, activities: {} };
      projectMap[proj].locations[loc].total++;
      if (isOpen) projectMap[proj].locations[loc].open++;
      if (isClosed) projectMap[proj].locations[loc].closed++;
      if (isOverdue) projectMap[proj].locations[loc].overdue++;
      projectMap[proj].locations[loc].activities[act] = (projectMap[proj].locations[loc].activities[act] || 0) + 1;
    });

    const projects = Object.entries(projectMap).map(([name, data]) => ({
      name,
      ...data,
      locations: Object.entries(data.locations).map(([name, counts]) => ({
        name,
        total: counts.total,
        open: counts.open,
        closed: counts.closed,
        overdue: counts.overdue,
        activities: Object.entries(counts.activities).map(([a, c]) => ({ name: a, count: c })).sort((a, b) => b.count - a.count),
      })).sort((a, b) => b.total - a.total),
    })).sort((a, b) => b.total - a.total);

    return { total, openCount, closedCount, overdueCount, projects };
  }, [selectedEngineer, uaucs]);

  const activityDetail = useMemo(() => {
    if (!selectedActivityDetail) return null;
    const filtered = uaucs.filter(u => (u.activity || 'Unknown') === selectedActivityDetail);
    const engMap: Record<string, { count: number; projects: Set<string>; locations: Set<string> }> = {};
    filtered.forEach(u => {
      const e = u.site_engineer || 'Unknown';
      if (!engMap[e]) engMap[e] = { count: 0, projects: new Set(), locations: new Set() };
      engMap[e].count++;
      if (u.project) engMap[e].projects.add(u.project);
      if (u.location) engMap[e].locations.add(u.location);
    });
    const engineers = Object.entries(engMap)
      .map(([name, data]) => ({ name, ...data, projects: [...data.projects], locations: [...data.locations] }))
      .sort((a, b) => b.count - a.count);
    return { activity: selectedActivityDetail, total: filtered.length, engineers };
  }, [selectedActivityDetail, uaucs]);

  const activityEngineerRanking = useMemo(() => {
    const actEngMap: Record<string, Record<string, number>> = {};
    uaucs.forEach(u => {
      const a = u.activity || 'Unknown';
      const e = u.site_engineer || 'Unknown';
      if (!actEngMap[a]) actEngMap[a] = {};
      actEngMap[a][e] = (actEngMap[a][e] || 0) + 1;
    });
    return Object.entries(actEngMap)
      .map(([activity, engMap]) => {
        const total = Object.values(engMap).reduce((s, c) => s + c, 0);
        const topEngineer = Object.entries(engMap).sort((a, b) => b[1] - a[1])[0];
        return { activity, total, topEngineerName: topEngineer?.[0] || '', topEngineerCount: topEngineer?.[1] || 0 };
      })
      .sort((a, b) => b.total - a.total);
  }, [uaucs]);

  const formatDate = (d: string | null) => {
    if (!d) return '--';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const statusColor = (s: string) => {
    const su = (s || '').toUpperCase();
    if (su === 'OPEN') return 'bg-blue-100 text-blue-700';
    if (su === 'AWAITING_APPROVAL') return 'bg-yellow-100 text-yellow-700';
    if (su === 'ACCEPTED' || su === 'CLOSED') return 'bg-emerald-100 text-emerald-700';
    if (su === 'REWORK_REQUIRED') return 'bg-orange-100 text-orange-700';
    if (su === 'REJECTED') return 'bg-rose-100 text-rose-700';
    if (su === 'OVERDUE') return 'bg-rose-100 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  };

  const clearFilters = () => {
    setFromDate(monthStart);
    setToDate(today);
    setSelectedBU('All');
    setSelectedProject('All');
    setSelectedLocation('All');
    setSelectedActivity('All');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Individual Dashboard</h1>
          <p className="text-slate-500 text-sm">Detailed view of all individual UAUC records</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Clock size={12} />
          <span>{loading ? 'Refreshing...' : `Last updated: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">BU</label>
            <select value={selectedBU} onChange={e => setSelectedBU(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
              <option value="All">All BUs</option>
              {[...new Set([...allBUList, 'Bridges', 'Roads & Runways'])].filter(b => b !== 'Unassigned').sort().map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</label>
            <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
              <option value="All">All Projects</option>
              {filteredProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Location</label>
            <select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
              <option value="All">All Locations</option>
              {allLocations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {allActivityList.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</label>
              <select value={selectedActivity} onChange={e => setSelectedActivity(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm min-w-[160px]">
                <option value="All">All Activities</option>
                {allActivityList.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          {(fromDate !== monthStart || toDate !== today || selectedBU !== 'All' || selectedProject !== 'All' || selectedLocation !== 'All' || selectedActivity !== 'All') && (
            <button onClick={clearFilters} className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors">
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Records', value: uaucs.length, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', icon: ClipboardCheck },
          { label: 'Open / In Progress', value: openCount, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', icon: Clock },
          { label: 'Closed / Accepted', value: closedCount, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: CheckCircle2 },
          { label: 'Overdue', value: overdueCount, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100', icon: AlertTriangle },
        ].map(({ label, value, color, bg, border, icon: Icon }) => (
          <div key={label} className={`p-4 ${bg} rounded-2xl border ${border} hover:shadow-md transition-all`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
              <Icon className={color} size={16} />
            </div>
            <p className={`text-2xl font-black ${color}`}>{value}</p>
          </div>
        ))}
        {/* Combined Day / Night Shift card */}
        <div className="p-4 bg-gradient-to-br from-sky-50 to-indigo-50 rounded-2xl border border-sky-100 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Day / Night</p>
            <Activity className="text-sky-600" size={16} />
          </div>
          <p className="text-2xl font-black text-sky-600">
            {dayCount}
            <span className="text-slate-400 mx-1">/</span>
            <span className="text-indigo-600">{nightCount}</span>
          </p>
        </div>
      </div>

      {/* Most Critical Activity + Site Engineer Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Most Critical Activity */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Most Critical Activity</p>
          {mostCriticalActivity ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-lg font-black text-slate-900">{mostCriticalActivity.name}</span>
                <span className="text-sm font-bold text-blue-600">{mostCriticalActivity.count} UAUCs</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(mostCriticalActivity.count / uaucs.length) * 100}%` }} />
              </div>
              <p className="text-xs text-slate-400">{((mostCriticalActivity.count / Math.max(uaucs.length, 1)) * 100).toFixed(1)}% of all records</p>
              {top5CriticalEngineers.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Top Site Engineers — {mostCriticalActivity.name}</p>
                  <div className="space-y-2">
                    {top5CriticalEngineers.map((eng, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
                            {i + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">{eng.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-500">{eng.count} UAUCs</span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(eng.count / top5CriticalEngineers[0].count) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {restCriticalEngineers.length > 0 && (
                    <>
                      {!showAllCriticalEngineers && (
                        <button onClick={() => setShowAllCriticalEngineers(true)}
                          className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                          <ChevronDown size={14} />
                          <span>Show {restCriticalEngineers.length} more engineer{restCriticalEngineers.length !== 1 ? 's' : ''}</span>
                        </button>
                      )}
                      {showAllCriticalEngineers && (
                        <>
                          <div className="space-y-2 mt-2">
                            {restCriticalEngineers.map((eng, i) => (
                              <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-slate-100 text-slate-500">
                                    {i + 6}
                                  </span>
                                  <span className="text-xs font-semibold text-slate-700">{eng.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-slate-500">{eng.count} UAUCs</span>
                                  <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(eng.count / top5CriticalEngineers[0].count) * 100}%` }} />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => setShowAllCriticalEngineers(false)}
                            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                            <ChevronUp size={14} />
                            <span>Show less</span>
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No activity data available</p>
          )}
        </div>

        {/* Site Engineer Summary */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-5 pb-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Site Engineer Summary</p>
            <p className="text-xs text-slate-400 mt-1">{engineerSummary.length} engineer{engineerSummary.length !== 1 ? 's' : ''} registered UAUCs</p>
          </div>
          <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Site Engineer</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">UAUCs</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">%</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {engineerSummary.map((e, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2 text-xs font-semibold text-slate-900">{e.name}</td>
                    <td className="px-4 py-2 text-xs font-bold text-slate-900 text-right">{e.count}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 text-right">{((e.count / Math.max(uaucs.length, 1)) * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2">
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(e.count / Math.max(engineerSummary[0]?.count || 1, 1)) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                {engineerSummary.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No engineer data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Top UAUC Activities Ranking */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Top UAUC Activities</h2>
          <p className="text-xs text-slate-400">Ranked by total UAUC count with the Site Engineer who has the most UAUCs under each activity</p>
        </div>
        {activityEngineerRanking.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Total UAUCs</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Top Site Engineer</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Engineer UAUCs</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activityEngineerRanking.map((item, i) => {
                  const barWidth = activityEngineerRanking.length > 0 ? (item.total / activityEngineerRanking[0].total) * 100 : 0;
                  return (
                    <tr key={i} className="hover:bg-blue-50/50 transition-colors cursor-pointer" onClick={() => setSelectedActivityDetail(item.activity)}>
                      <td className="px-4 py-3 text-xs font-bold text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors">{item.activity}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-900 text-right">{item.total}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-blue-700">{item.topEngineerName}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">{item.topEngineerCount}</td>
                      <td className="px-4 py-3">
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barWidth}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-slate-400">No activity data available</div>
        )}
      </div>

      {/* Activity Detail Modal */}
      {selectedActivityDetail && activityDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedActivityDetail(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{activityDetail.activity}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{activityDetail.total} total UAUCs across {activityDetail.engineers.length} engineer{activityDetail.engineers.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setSelectedActivityDetail(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {activityDetail.engineers.map((eng, i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-bold text-slate-900">{eng.name}</span>
                    </div>
                    <span className="text-xs font-bold text-blue-600">{eng.count} UAUCs</span>
                  </div>
                  {eng.projects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {eng.projects.map((p, j) => (
                        <span key={j} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-semibold">{p}</span>
                      ))}
                    </div>
                  )}
                  {eng.locations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {eng.locations.map((l, j) => (
                        <span key={j} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold">{l}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
              <button onClick={() => setSelectedActivityDetail(null)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all">Close</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* All Site Engineers */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Site Engineers</h2>
          <p className="text-xs text-slate-400">{engineerSummary.length} engineer{engineerSummary.length !== 1 ? 's' : ''} — click to view projects, activities &amp; locations</p>
        </div>
        {engineerSummary.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Site Engineer</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">UAUCs</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">%</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {engineerSummary.map((eng, i) => (
                  <tr key={i} className="hover:bg-blue-50/50 transition-colors cursor-pointer" onClick={() => setSelectedEngineer(eng.name)}>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">{eng.name}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-900 text-right">{eng.count}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 text-right">{((eng.count / Math.max(uaucs.length, 1)) * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(eng.count / Math.max(engineerSummary[0]?.count || 1, 1)) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center">
            <Users size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">No engineer data available</h3>
            <p className="text-slate-500 text-sm">No UAUC records match the current filters.</p>
          </div>
        )}
      </div>

      {/* Engineer Detail Modal */}
      {selectedEngineer && engineerDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedEngineer(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{selectedEngineer}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{engineerDetail.total} total UAUCs across {engineerDetail.projects.length} project{engineerDetail.projects.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setSelectedEngineer(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={18} className="text-slate-400" />
              </button>
            </div>

            {/* KPI Strip */}
            <div className="grid grid-cols-4 gap-3 p-5 shrink-0">
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total</p>
                <p className="text-xl font-black text-blue-600">{engineerDetail.total}</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Open</p>
                <p className="text-xl font-black text-amber-600">{engineerDetail.openCount}</p>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Closed</p>
                <p className="text-xl font-black text-emerald-600">{engineerDetail.closedCount}</p>
              </div>
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Overdue</p>
                <p className="text-xl font-black text-rose-600">{engineerDetail.overdueCount}</p>
              </div>
            </div>

            {/* Projects & Locations */}
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
              {engineerDetail.projects.map((proj, pi) => (
                <div key={pi} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MapPin size={14} className="text-blue-500" />
                      <span className="text-sm font-bold text-slate-900">{proj.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-bold">
                      <span className="text-blue-600">{proj.total} Total</span>
                      <span className="text-amber-600">{proj.open} Open</span>
                      <span className="text-emerald-600">{proj.closed} Closed</span>
                      <span className="text-rose-600">{proj.overdue} Overdue</span>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {proj.locations.map((loc, li) => (
                      <div key={li} className="px-4 py-2.5 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-700">{loc.name}</span>
                          <div className="flex items-center gap-3 text-[10px] font-bold">
                            <span className="text-slate-500 w-8 text-right">{loc.total}</span>
                            <span className="text-amber-600 w-8 text-right">{loc.open}</span>
                            <span className="text-emerald-600 w-8 text-right">{loc.closed}</span>
                            <span className="text-rose-600 w-8 text-right">{loc.overdue}</span>
                            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden flex ml-1">
                              {loc.total > 0 && (
                                <>
                                  <div className="h-full bg-amber-400" style={{ width: `${(loc.open / loc.total) * 100}%` }} />
                                  <div className="h-full bg-emerald-400" style={{ width: `${(loc.closed / loc.total) * 100}%` }} />
                                  <div className="h-full bg-rose-400" style={{ width: `${(loc.overdue / loc.total) * 100}%` }} />
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {loc.activities.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {loc.activities.map((act, ai) => (
                              <span key={ai} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-semibold">
                                {act.name}{act.count > 1 ? ` (${act.count})` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
              <button onClick={() => setSelectedEngineer(null)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all">Close</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* UAUC Records Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">UAUC Records</h2>
            <p className="text-xs text-slate-400">{loading ? 'Loading...' : `${uaucs.length} records found`}</p>
          </div>
        </div>
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 size={32} className="mx-auto text-blue-500 animate-spin mb-3" />
            <p className="text-sm text-slate-500">Loading UAUC records...</p>
          </div>
        ) : uaucs.length === 0 ? (
          <div className="p-12 text-center">
            <Database size={48} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Records Found</h3>
            <p className="text-slate-500 text-sm">No UAUC records match the current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Audit ID</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Site Engineer</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Obs. Date</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Obs. Time</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Shift</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Closed Date</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Safety Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uaucs.map((item: any) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors align-top">
                    <td className="px-3 py-2 text-xs font-mono font-medium text-blue-600 whitespace-nowrap">{item.audit_id}</td>
                    <td className="px-3 py-2 text-xs font-medium text-slate-900">{item.activity || '--'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{item.project || '--'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{item.location || '--'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{item.site_engineer || '--'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.observation_date)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{item.observation_time || '--'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${item.shift === 'Day' ? 'bg-sky-100 text-sky-700' : item.shift === 'Night' ? 'bg-purple-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {item.shift}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColor(item.status)}`}>
                        {item.status || 'OPEN'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(item.closed_date)}</td>
                    <td className="px-3 py-2 max-w-[200px] text-xs text-slate-600 truncate">{item.safety_issues || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Admin Page ────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Admin page — user/role management
// ---------------------------------------------------------------------------
const AdminPage = React.memo(function AdminPage({ userRole }: { userRole: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [deletingUser, setDeletingUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  // Form fields
  const [formPs, setFormPs] = useState('');
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('site');
  const [formProject, setFormProject] = useState('MPSB');

  useEffect(() => {
    fetch('/api/auth/stats').then(r => r.ok ? r.json() : null).then(setStats).catch(() => {});
    loadUsers();
  }, []);

  const loadUsers = () => {
    setLoading(true);
    fetch('/api/auth/users')
      .then(r => r.ok ? r.json() : [])
      .then(data => setUsers(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };
  const roleBadge = (role: string) => {
    if (role === 'super_admin') return <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold">Super Admin</span>;
    if (role === 'ehs') return <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">EHS</span>;
    return <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">Site</span>;
  };

  const openCreate = () => {
    setFormPs(''); setFormName(''); setFormEmail(''); setFormRole('site'); setFormProject('MPSB');
    setEditingUser(null);
    setShowCreate(true);
  };

  const openEdit = (u: any) => {
    setFormPs(u.ps_number); setFormName(u.employee_name); setFormEmail(u.mail_id);
    setFormRole(u.role); setFormProject(u.project_name);
    setEditingUser(u);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPs.trim() || !formEmail.trim()) { showToast('Please fill all required fields'); return; }
    setSaving(true);
    try {
      if (editingUser) {
        const res = await fetch(`/api/auth/users/${editingUser.ps_number}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_name: formName, mail_id: formEmail, role: formRole, project_name: formProject }),
        });
        if (!res.ok) { const e = await res.json(); showToast(e.detail || 'Update failed'); setSaving(false); return; }
        showToast('User updated');
      } else {
        const res = await fetch('/api/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ps_number: formPs, employee_name: formName, mail_id: formEmail, role: formRole, project_name: formProject }),
        });
        if (!res.ok) { const e = await res.json(); showToast(e.detail || 'Create failed'); setSaving(false); return; }
        showToast('User created');
      }
      setShowCreate(false);
      loadUsers();
      fetch('/api/auth/stats').then(r => r.ok ? r.json() : null).then(setStats).catch(() => {});
    } catch { showToast('Operation failed'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/auth/users/${deletingUser.ps_number}`, { method: 'DELETE' });
      if (!res.ok) { const e = await res.json(); showToast(e.detail || 'Delete failed'); setSaving(false); setDeletingUser(null); return; }
      showToast('User deleted');
      setDeletingUser(null);
      loadUsers();
      fetch('/api/auth/stats').then(r => r.ok ? r.json() : null).then(setStats).catch(() => {});
    } catch { showToast('Delete failed'); }
    setSaving(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      {toast && <div className="fixed top-6 right-6 z-50 px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold shadow-2xl animate-in slide-in-from-right-2">{toast}</div>}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
          <p className="text-slate-500 text-sm">System overview and user management</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-sm font-bold">Super Admin</div>
          <button onClick={openCreate} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-500 transition-all shadow-sm active:scale-[0.98] flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add User
          </button>
        </div>
      </div>

      {/* System Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Users</p>
            <p className="text-3xl font-black text-slate-900">{stats.total_users}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Site Engineers</p>
            <p className="text-3xl font-black text-slate-900">{stats.by_role.site}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">EHS Engineers</p>
            <p className="text-3xl font-black text-slate-900">{stats.by_role.ehs}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Projects</p>
            <p className="text-3xl font-black text-slate-900">{stats.projects?.length || 0}</p>
          </div>
        </div>
      )}

      {/* User Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">
            All Users
            {stats?.projects?.length > 0 && (
              <span className="ml-2 text-[11px] font-normal text-slate-400">in {stats.projects.join(', ')}</span>
            )}
          </h3>
        </div>
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading users...</p>
          </div>
        ) : !users.length ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-400">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Employee</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">PS Number</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5"><p className="text-sm font-semibold text-slate-900">{u.employee_name}</p></td>
                    <td className="px-5 py-3.5">{roleBadge(u.role)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600 font-mono">{u.ps_number}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{u.mail_id}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{u.project_name}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-all" title="Edit">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        {u.role !== 'super_admin' && (
                          <button onClick={() => setDeletingUser(u)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all" title="Delete">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-0">
              <h3 className="text-lg font-bold text-slate-900">{editingUser ? 'Edit User' : 'Add User'}</h3>
              <p className="text-xs text-slate-400 mt-1">{editingUser ? 'Update user details and role' : 'Create a new system user'}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">PS Number</label>
                <SpeechInput value={formPs} onChange={e => setFormPs(e.target.value)} disabled={!!editingUser} required
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Employee Name</label>
                <SpeechInput value={formName} onChange={e => setFormName(e.target.value)} required
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Email</label>
                <SpeechInput type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Role</label>
                <select value={formRole} onChange={e => setFormRole(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  <option value="site">Site Engineer</option>
                  <option value="ehs">EHS Engineer</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Project</label>
                <SpeechInput value={formProject} onChange={e => setFormProject(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 pb-6">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all active:scale-[0.98]">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-500 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDeletingUser(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center">Delete User</h3>
              <p className="text-sm text-slate-500 text-center mt-2">Are you sure you want to delete <strong>{deletingUser.employee_name}</strong> ({deletingUser.ps_number})? This action cannot be undone.</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 pb-6">
              <button onClick={() => setDeletingUser(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all active:scale-[0.98]">Cancel</button>
              <button onClick={handleDelete} disabled={saving}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-500 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50">{saving ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Login Page ────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------
const LoginPage = React.memo(function LoginPage({ onLogin }: { onLogin: (user: { ps_number: string; role: 'ehs' | 'site' | 'super_admin' | 'sbg'; name: string; mail_id: string; project_name: string; sbg: string; bu: string; access_token: string }) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mail_id: username, ps_number: password }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Invalid username or password');
      }
      const data = await res.json();
      onLogin({ ps_number: data.ps_number, role: data.role, name: data.employee_name, mail_id: data.mail_id, project_name: data.project_name, sbg: data.sbg || '', bu: data.bu || '', access_token: data.access_token || '' });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200 mx-auto mb-4">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Know Harm AI</h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-bold">Building a Culture of Shared Safety</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 mb-5">Sign In</h2>
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle size={16} className="text-red-500 shrink-0" />
              <p className="text-xs font-medium text-red-600">{error}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Username</label>
              <SpeechInput value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your email" required autoComplete="off"
                className="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your PS Number" required autoComplete="new-password"
                  className="w-full h-11 px-4 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full h-11 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-500 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </div>
        </form>
        <p className="text-center text-[10px] text-slate-400 mt-6 uppercase tracking-wider font-bold">Enter your credentials to continue</p>
      </div>
    </div>
  );
});

// ─── Mobile Workspace Loader ──────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Mobile workspace loader — full-screen loading + permission gate
// ---------------------------------------------------------------------------
const MobileWorkspaceLoader = React.memo(function MobileWorkspaceLoader({ user, onComplete }: {
  user: { ps_number: string; role: 'ehs' | 'site' | 'super_admin' | 'sbg'; name: string; mail_id: string; project_name: string };
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 600);
    const t2 = setTimeout(() => setStep(2), 1400);
    const t3 = setTimeout(() => onComplete(), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning,' : hour < 18 ? 'Good Afternoon,' : 'Good Evening,';

  const progressPct = step === 0 ? 0 : step === 1 ? 35 : step === 2 ? 70 : 100;

  const items = [
    { label: 'Syncing submitted UAUCs', doneAt: 1 },
    { label: 'Loading review queue', doneAt: 2 },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-[#F5F6F8] flex flex-col items-center justify-center px-6 animate-in fade-in duration-500">
      {/* Profile Section */}
      <div className="flex flex-col items-center mb-10">
        <div className="w-[88px] h-[88px] rounded-full bg-slate-200 border-4 border-white shadow-md overflow-hidden mb-4">
          <img
            src={`https://picsum.photos/seed/${user.name}/200/200`}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <p className="text-sm text-slate-500 mb-1">{greeting}</p>
        <h2 className="text-xl font-bold text-slate-900">{user.name}</h2>
        <p className="text-sm text-slate-400 mt-0.5">{user.role === 'super_admin' ? 'Super Admin' : user.role === 'ehs' ? 'EHS Engineer' : user.role === 'sbg' ? 'SBG' : 'Site Engineer'}</p>
      </div>

      {/* Loading Status Card */}
      <div className="w-[88%] max-w-sm bg-white rounded-2xl shadow-md px-5 py-5 space-y-4">
        {items.map((item, i) => {
          const idx = i + 1;
          const done = step >= idx;
          const active = step === idx - 1;
          return (
            <div key={i} className="flex items-center gap-3">
              {done ? (
                <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
              ) : active ? (
                <Loader2 size={20} className="text-blue-500 shrink-0 animate-spin" />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-slate-200 shrink-0" />
              )}
              <span className={cn("text-sm font-medium", done ? "text-slate-700" : active ? "text-slate-500" : "text-slate-400")}>
                {item.label}
              </span>
            </div>
          );
        })}

        {/* Progress Bar */}
        <div className="pt-2">
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-blue-500 rounded-full"
              initial={{ width: '0%' }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            />
          </div>
        </div>
      </div>

      {/* Footer Message */}
      <p className="text-xs text-slate-400 mt-6">Preparing your workspace...</p>
    </div>
  );
});

// --- Searchable Select Component ---

// ─── Mobile Home Dashboard ───────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Mobile home page — phone-optimized dashboard with bottom nav
// ---------------------------------------------------------------------------
const MobileHomePage = React.memo(function MobileHomePage({ user, submissions, setActivePage, onLogout, onViewDetail, onEhsReview, defaultTab, defaultStatusFilter }: {
  user: { ps_number: string; role: 'ehs' | 'site' | 'super_admin' | 'sbg'; name: string; mail_id: string; project_name: string; sbg?: string; bu?: string };
  submissions: any[];
  setActivePage: (p: Page) => void;
  onLogout?: () => void;
  onViewDetail?: (id: number) => void;
  onEhsReview?: (item: any, list?: any[]) => void;
  defaultTab?: string;
  defaultStatusFilter?: string;
}) {
  const [activeTab, setActiveTab] = useState(defaultTab || 'home');
  const [statusFilter, setStatusFilter] = useState(defaultStatusFilter || 'Open');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [uaucItems, setUaucItems] = useState<any[]>([]);
  const [uaucSummary, setUaucSummary] = useState<any>({ open: 0, awaiting_approval: 0, rework_required: 0, overdue: 0 });
  const [uaucLoading, setUaucLoading] = useState(true);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning,' : hour < 18 ? 'Good Afternoon,' : 'Good Evening,';

  useEffect(() => {
    if (!user?.name) return;
    const params = new URLSearchParams();
    if (user.role === 'super_admin') {
      params.append('role', 'super_admin');
    } else if (user.role === 'site') {
      params.append('engineer', user.name);
    } else {
      params.append('initiated_by', user.name);
    }
    params.append('limit', '50');
    fetch(`/api/uaucs/my?${params.toString()}`)
      .then(r => r.ok ? r.json() : { items: [], total: 0, summary: {} })
      .then(data => {
        setUaucItems(data.items || []);
        setUaucSummary(data.summary || { open: 0, awaiting_approval: 0, rework_required: 0, overdue: 0 });
        setUaucLoading(false);
      })
      .catch(() => setUaucLoading(false));
  }, [user?.name, user?.role]);

  const apiIds = new Set(uaucItems.map(s => s.id));
  const localOnly = submissions.filter(s => !apiIds.has(s.id));
  const items = (() => {
    const sorted = [...localOnly, ...uaucItems];
    const todayStr = new Date().toISOString().split('T')[0];
    sorted.sort((a: any, b: any) => {
      const pri = (it: any): number => {
        const s = it.status;
        if (s === 'ACCEPTED' || s === 'CLOSED') return 4;
        if (s === 'AWAITING_APPROVAL') return 3;
        if (s === 'OPEN' && it.target_date && it.target_date < todayStr) return 0;
        if (s === 'REWORK_REQUIRED' || s === 'REJECTED') return 1;
        if (s === 'OPEN') return 2;
        return 5;
      };
      const pa = pri(a), pb = pri(b);
      if (pa !== pb) return pa - pb;
      const da = a.target_date ? new Date(a.target_date).getTime() : Infinity;
      const db = b.target_date ? new Date(b.target_date).getTime() : Infinity;
      return da - db;
    });
    return sorted;
  })();

  const isEHS = user.role === 'ehs';
  const todayStr = new Date().toISOString().split('T')[0];

  const totalTasks = items.filter(s => {
    const st = (s.status || '').toUpperCase();
    if (st === 'ACCEPTED' || st === 'CLOSED' || st === 'AWAITING_APPROVAL') return false;
    return (st === 'OPEN' || st === 'OVERDUE' || st === 'REWORK_REQUIRED') && s.target_date && s.target_date <= todayStr;
  }).length;
  const taskRequiresRework = items.filter(s => (s.status || '').toUpperCase() === 'REWORK_REQUIRED').length;
  const taskAwaitingApproval = items.filter(s => (s.status || '').toUpperCase() === 'AWAITING_APPROVAL').length;
  const drafts = items.filter(s => {
    const st = (s.status || '').toUpperCase();
    return (st === 'OPEN' || st === 'DRAFT' || !s.status) && !s.closure_se_date && !s.submittedOn;
  });
  const continueTask = drafts[0];
  const recentTasks = items.slice(0, 4);

  // EHS-specific metrics
  const pendingReviewCount = items.filter(s => {
    const st = (s.status || '').toUpperCase();
    return st === 'AWAITING_APPROVAL';
  }).length;
  const approvedTodayCount = items.filter(s => {
    const st = (s.status || '').toUpperCase();
    return (st === 'ACCEPTED' || st === 'CLOSED' || s.status === 'Approved');
  }).length || 0;
  const rejectedTodayCount = items.filter(s => {
    const st = (s.status || '').toUpperCase();
    return st === 'REJECTED' || st === 'REWORK_REQUIRED' || s.status === 'Rework Required';
  }).length || 0;
  const completedThisMonthCount = uaucSummary.closed_this_month || items.filter(s => {
    const st = (s.status || '').toUpperCase();
    return st === 'ACCEPTED' || st === 'CLOSED' || s.status === 'Approved' || s.status === 'Completed';
  }).length || 0;

  const ehsFilterTabs = [
    { id: 'Open', label: 'Open', color: 'text-orange-600', activeBg: 'bg-orange-500', match: ['OPEN', 'OVERDUE'] },
    { id: 'Awaiting Approval', label: 'Awaiting', color: 'text-purple-600', activeBg: 'bg-purple-600', match: ['AWAITING_APPROVAL', 'Awaiting Approval'] },
    { id: 'Rework Required', label: 'Rework', color: 'text-amber-600', activeBg: 'bg-amber-500', match: ['REWORK_REQUIRED', 'REJECTED', 'Rework Required', 'Rejected'] },
    { id: 'Approved', label: 'Approved', color: 'text-emerald-600', activeBg: 'bg-emerald-600', match: ['ACCEPTED', 'CLOSED', 'Approved', 'Completed'] },
  ];

  const ehsPriorityOrder: Record<string, number> = {
    'OVERDUE': 0, 'AWAITING_APPROVAL': 1, 'REWORK_REQUIRED': 2, 'OPEN': 3, 'ACCEPTED': 4, 'CLOSED': 4, 'REJECTED': 5,
  };

  const nm = (x: string) => x.toUpperCase().replace(/\s+/g, '_');
  const ehsFilteredItems = items
    .map(s => {
      const rawSt = nm(s.status || 'OPEN');
      const isOverdue = (rawSt === 'OPEN' || rawSt === 'OVERDUE' || !rawSt) && s.target_date && s.target_date < todayStr;
      return { ...s, _computedStatus: isOverdue ? 'OVERDUE' : rawSt };
    })
    .filter(s => {
      const q = debouncedSearch.toLowerCase();
      const tab = ehsFilterTabs.find(t => t.id === statusFilter);
      const statusMatch = !tab || tab.id === 'All' || tab.match.some(m => nm(m) === s._computedStatus);
      if (!statusMatch) return false;
      if (q) {
        const project = (s.project || s.location || '').toLowerCase();
        const uauc = (s.audit_id || s.uaucId || '').toLowerCase();
        const loc = (s.location || '').toLowerCase();
        const engineer = (s.site_engineer || s.assignedBy || '').toLowerCase();
        return project.includes(q) || uauc.includes(q) || loc.includes(q) || engineer.includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      const pa = ehsPriorityOrder[a._computedStatus] ?? 99;
      const pb = ehsPriorityOrder[b._computedStatus] ?? 99;
      if (pa !== pb) return pa - pb;
      const da = a.target_date ? new Date(a.target_date).getTime() : Infinity;
      const db = b.target_date ? new Date(b.target_date).getTime() : Infinity;
      return da - db;
    });

  const normalizeStatus = (st: string) => {
    const m: Record<string, string> = {
      'OPEN': 'Open', 'AWAITING_APPROVAL': 'Awaiting Approval', 'REWORK_REQUIRED': 'Rework Required',
      'ACCEPTED': 'Completed', 'CLOSED': 'Completed', 'REJECTED': 'Rework Required', 'OVERDUE': 'Open',
    };
    return m[st] || st;
  };

  const statusConfig: Record<string, { label: string; bg: string; text: string; btn: string; btnStyle: string }> = {
    'Open': { label: 'Open', bg: 'bg-orange-100', text: 'text-orange-700', btn: 'Continue →', btnStyle: 'bg-orange-500 text-white' },
    'Awaiting Approval': { label: 'Awaiting Approval', bg: 'bg-purple-100', text: 'text-purple-700', btn: 'View Closure Report', btnStyle: 'bg-blue-600 text-white' },
    'Rework Required': { label: 'Rework Required', bg: 'bg-red-100', text: 'text-red-700', btn: 'Continue Closure', btnStyle: 'bg-amber-500 text-white' },
    'Pending': { label: 'Open', bg: 'bg-orange-100', text: 'text-orange-700', btn: 'Continue →', btnStyle: 'bg-orange-500 text-white' },
    'Approved': { label: 'Completed', bg: 'bg-emerald-100', text: 'text-emerald-700', btn: 'View', btnStyle: 'bg-slate-900 text-white' },
    'Rejected': { label: 'Rework Required', bg: 'bg-red-100', text: 'text-red-700', btn: 'Continue Closure', btnStyle: 'bg-amber-500 text-white' },
    'Completed': { label: 'Completed', bg: 'bg-emerald-100', text: 'text-emerald-700', btn: 'View', btnStyle: 'bg-slate-900 text-white' },
  };

  const getStatusBadge = (status: string) => {
    const key = normalizeStatus(status);
    const cfg = statusConfig[key] || { label: key, bg: 'bg-slate-100', text: 'text-slate-700' };
    return (
      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${cfg.bg} ${cfg.text}`}>
        {cfg.label}
      </span>
    );
  };

  const filterTabs = [
    { id: 'Open', label: 'Open', color: 'text-orange-600', activeBg: 'bg-orange-100', match: ['OPEN', 'OVERDUE', 'Pending', 'Open'] },
    { id: 'Awaiting Approval', label: 'Awaiting', color: 'text-purple-600', activeBg: 'bg-purple-100', match: ['AWAITING_APPROVAL', 'Awaiting Approval'] },
    { id: 'Rework Required', label: 'Rework', color: 'text-red-600', activeBg: 'bg-red-100', match: ['REWORK_REQUIRED', 'REJECTED', 'Rework Required', 'Rejected'] },
    { id: 'Accepted', label: 'Accepted', color: 'text-emerald-600', activeBg: 'bg-emerald-100', match: ['ACCEPTED', 'CLOSED', 'Approved'] },
  ];

  const filterTodayStr = new Date().toISOString().split('T')[0];
  const filteredItems = items
    .map(s => {
      const rawSt = (s.status || 'OPEN').toUpperCase().replace(/\s+/g, '_');
      const isOverdue = (rawSt === 'OPEN' || rawSt === 'OVERDUE' || !rawSt) && s.target_date && s.target_date < filterTodayStr;
      return { ...s, _computedStatus: isOverdue ? 'OVERDUE' : rawSt };
    })
    .filter(s => {
      const q = debouncedSearch.toLowerCase();
      const tab = filterTabs.find(t => t.id === statusFilter);
      const statusMatch = !tab || tab.id === 'All' || tab.match.some(m => m.toUpperCase().replace(/\s+/g, '_') === s._computedStatus);
      if (!statusMatch) return false;
      if (q) {
        const project = (s.project || s.location || '').toLowerCase();
        const uauc = (s.audit_id || s.uaucId || '').toLowerCase();
        const loc = (s.location || '').toLowerCase();
        return project.includes(q) || uauc.includes(q) || loc.includes(q);
      }
      return true;
    });

  const profileTabLabel = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : '👤';

  const isSuper = user.role === 'super_admin';
  const isSBGMobile = user.role === 'sbg';
  const navTabs = isSBGMobile ? [
    { id: 'executive-dashboard', icon: LayoutDashboard, label: 'Executive' },
    { id: 'sbg-dashboard', icon: LayoutDashboard, label: 'SBG Dashboard' },
  ] : (isEHS || isSuper) ? [
    { id: 'home', icon: LayoutDashboard, label: 'Home' },
    { id: 'uauc-capture', icon: Camera, label: 'UAUC Capture' },
    { id: 'my-tasks', icon: ClipboardCheck, label: 'My Tasks' },
    { id: 'profile', icon: Users, label: 'Profile' },
  ] : user?.role === 'site' ? [
    { id: 'home', icon: LayoutDashboard, label: 'Home' },
    { id: 'site-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'my-tasks', icon: ClipboardCheck, label: 'My Tasks' },
    { id: 'profile', icon: Users, label: 'Profile' },
  ] : [
    { id: 'home', icon: LayoutDashboard, label: 'Home' },
    { id: 'my-tasks', icon: ClipboardCheck, label: 'My Tasks' },
    { id: 'profile', icon: Users, label: 'Profile' },
  ];

  const handleNav = (id: string) => {
    if (id === 'executive-dashboard') {
      setActivePage('executive-dashboard');
      return;
    }
    if (id === 'sbg-dashboard') {
      setActivePage('project-dashboard');
      return;
    }
    if (id === 'site-dashboard') {
      setActivePage('site-dashboard');
      return;
    }
    if (id === 'uauc-capture') {
      if (isEHS) {
        setActivePage('audit');
      } else {
        setActiveTab('uauc-capture');
      }
      return;
    }
    if (id === 'home' || id === 'my-tasks' || id === 'profile') {
      setActiveTab(id);
    }
  };

  if (activeTab === 'my-tasks') {
    if (isEHS) {
      return (
        <div className="fixed inset-0 z-[90] bg-[#F5F6F8] flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-3 pb-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-500 mb-0.5">{greeting}</p>
              <h1 className="text-xl font-bold text-slate-900 mt-0.5">{user.name} 👋</h1>
              <p className="text-xs text-slate-400 mt-0.5">EHS Engineer</p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <button onClick={onLogout} className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Logout">
                <LogOut size={20} />
              </button>
              <div className="w-[42px] h-[42px] rounded-full bg-blue-100 border-2 border-white shadow-sm overflow-hidden">
                <img src={`https://picsum.photos/seed/${user.name}/200/200`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
            </div>
          </div>

          {/* My Tasks Title */}
          <div className="px-5 pb-2">
            <h2 className="text-lg font-bold text-slate-900">My Tasks</h2>
          </div>

          {/* Filter Tabs */}
          <div className="px-5 pb-3">
          <div className="grid grid-cols-4 gap-2">
              {ehsFilterTabs.map(tab => {
                const isActive = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={cn(
"w-full px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors",
                      isActive
                        ? tab.activeBg + ' text-white shadow-sm'
                        : "bg-white border border-slate-200 text-slate-600"
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div className="px-5 pb-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <SpeechInput
                placeholder="Search UAUC ID, Project or Engineer"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 shadow-sm"
              />
            </div>
          </div>

          {/* Task List */}
          <div className="flex-1 overflow-y-auto px-5 pb-28 space-y-3">
            {ehsFilteredItems.length > 0 ? (
              ehsFilteredItems.map((s, i) => {
                const displayId = s.audit_id || s.uaucId || 'UAUC-0000';
                const issueCount = s.issues_count || s.issuesFixed || s.safety_issues?.length || 0;
                const submittedDate = s.submittedOn || (s.closure_se_date ? new Date(s.closure_se_date + 'T' + (s.closure_se_time || '00:00')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + (s.closure_se_time ? ', ' + s.closure_se_time : '') : '') || s.raisedOn || '';
                const assignedBy: string = s.site_engineer || s.assignedBy || s.initiated_by || '';
                const statusKey = s._computedStatus === 'OVERDUE' ? 'Overdue' : s._computedStatus === 'AWAITING_APPROVAL' ? 'Awaiting Approval' : (s._computedStatus === 'ACCEPTED' || s._computedStatus === 'CLOSED' ? 'Approved' : (s._computedStatus === 'REJECTED' || s._computedStatus === 'REWORK_REQUIRED' ? 'Rework Required' : 'Open'));
                const statusColors: Record<string, string> = { 'Awaiting Approval': 'bg-purple-100 text-purple-700', 'Approved': 'bg-emerald-100 text-emerald-700', 'Rework Required': 'bg-red-100 text-red-700', 'Open': 'bg-orange-100 text-orange-700', 'Overdue': 'bg-red-100 text-red-700' };
                const assignedInitials = assignedBy ? assignedBy.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) : '';
                return (
                  <div key={s.id || i} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="flex p-3 gap-3">
                      <div className="w-[76px] h-[76px] rounded-xl bg-slate-100 shrink-0 overflow-hidden">
                        {s.image_url ? (
                          <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-50 to-slate-100">
                            <span className="text-lg font-bold text-slate-400">{displayId.slice(-3)}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm font-bold text-slate-900 truncate">{s.location || s.project || '--'}</p>
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 whitespace-nowrap ${statusColors[statusKey] || 'bg-slate-100 text-slate-700'}`}>
                            {statusKey}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">{displayId}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <MapPin size={11} className="text-slate-400 shrink-0" />
                          <span className="text-[10px] text-slate-500 truncate">{s.location || s.project || '--'}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <AlertTriangle size={11} className="text-slate-400" /> {issueCount} {issueCount === 1 ? 'Issue' : 'Issues'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={11} className="text-slate-400" /> {submittedDate || '--'}
                          </span>
                        </div>
                        {assignedBy && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center">
                              <span className="text-[8px] font-bold text-purple-700">{assignedInitials}</span>
                            </div>
                            <span className="text-[10px] text-slate-500">{assignedBy}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="px-3 pb-3 flex justify-end">
                      <button
                        onClick={() => onEhsReview?.(s)}
                        className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-sm"
                      >
                        Review →
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center">
                <ClipboardCheck size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-bold text-slate-700">No Tasks Found</p>
                <p className="text-xs text-slate-400 mt-1">Try a different filter or search term</p>
              </div>
            )}
          </div>

          {/* Bottom Navigation */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)'}}>
            <div className="flex items-center justify-around py-1">
              {navTabs.map(tab => {
                const Icon = tab.icon;
                const isActiveTab = activeTab === tab.id;
                return (
                  <button key={tab.id} onClick={() => handleNav(tab.id)} className="flex flex-col items-center gap-0.5 min-w-[60px] py-1.5">
                    <div className={cn("flex items-center justify-center w-8 h-8 rounded-xl transition-all", isActiveTab && "bg-blue-50")}>
                      <Icon size={20} className={isActiveTab ? 'text-blue-600' : 'text-slate-400'} />
                    </div>
                    <span className={`text-[9px] font-semibold ${isActiveTab ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-[90] bg-white flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3">
          <h1 className="text-xl font-bold text-slate-900">My Tasks</h1>
          <div className="w-9 h-9 rounded-full bg-blue-100 border-2 border-white shadow-sm overflow-hidden shrink-0">
            <img src={`https://picsum.photos/seed/${user.name}/200/200`} alt="" className="w-full h-full object-cover" />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-5 pb-3">
            <div className="grid grid-cols-4 gap-2">
            {filterTabs.map(tab => {
              const isActiveTab = statusFilter === tab.id;
              const activeClass = tab.id === 'Open' ? 'bg-orange-500 text-white' :
                tab.id === 'Awaiting Approval' ? 'bg-purple-600 text-white' :
                tab.id === 'Rework Required' ? 'bg-red-500 text-white' :
                tab.id === 'Accepted' ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white';
              return (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={cn(
                    "w-full px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors",
                    isActiveTab ? activeClass : "bg-slate-100 text-slate-700"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <SpeechInput
              placeholder="Search UAUC ID, Project or Location"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto px-5 pb-28 space-y-3">
          {filteredItems.length > 0 ? (
            filteredItems.map((s, i) => {
              const todayStr = new Date().toISOString().split('T')[0];
              const computedStatus = (() => {
                if (s.status === 'ACCEPTED') return 'ACCEPTED';
                if (s.status === 'REWORK_REQUIRED') return 'REWORK_REQUIRED';
                if (s.status === 'CLOSED') return 'CLOSED';
                if (s.status === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
                if (s.target_date && s.target_date < todayStr) return 'OVERDUE';
                return 'OPEN';
              })();
              const badgeCfg: Record<string, { label: string; bg: string; text: string; dot: string }> = {
                OPEN: { label: 'Open', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
                CLOSED: { label: 'Closed', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
                ACCEPTED: { label: 'Accepted', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
                REJECTED: { label: 'Rejected', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
                AWAITING_APPROVAL: { label: 'Awaiting Approval', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
                REWORK_REQUIRED: { label: 'Rework Required', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
                OVERDUE: { label: 'Open (Overdue)', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
              };
              const badge = badgeCfg[computedStatus] || badgeCfg.OPEN;
              const displayId = s.audit_id || s.uaucId || 'UAUC-0000';
              const issueCount = s.issues_count || 0;
              const isOverdue = s.target_date && s.target_date < todayStr && s.status !== 'CLOSED';
              return (
                <div key={s.id || i} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-3" onClick={() => onViewDetail?.(s.id)}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                        {s.has_image || s.image_url ? (
                          <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900">{displayId}</p>
                        <p className="text-xs text-slate-500 truncate">{s.location || s.project || '--'}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${badge.bg} ${badge.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Issues</p>
                        <p className="font-bold text-slate-900">{issueCount}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Target Date</p>
                        <p className={cn("font-semibold", isOverdue ? 'text-red-600' : 'text-slate-700')}>
                          {s.target_date
                            ? new Date(s.target_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            : '--'}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      {computedStatus === 'REWORK_REQUIRED' ? (
                        <span className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-bold">
                          Continue Closure
                        </span>
                      ) : (
                        <span className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-bold">
                          View
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center">
              <FileText size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm font-bold text-slate-900">No UAUCs Found</p>
              <p className="text-xs text-slate-500 mt-1">No compliance findings assigned to you yet.</p>
            </div>
          )}
        </div>

        {/* Bottom Navigation */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-3" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)'}}>
          <div className="flex items-center justify-around py-2">
            {navTabs.map(tab => {
              const Icon = tab.icon;
              const isActiveTab = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => handleNav(tab.id)} className="flex flex-col items-center gap-0.5 min-w-[64px] py-1">
                  <Icon size={22} className={isActiveTab ? 'text-blue-600' : 'text-slate-400'} />
                  <span className={`text-[10px] font-semibold ${isActiveTab ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

    if (activeTab === 'uauc-capture' && !isEHS) {
    return (
      <div className="fixed inset-0 z-[90] bg-[#F5F6F8] flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-5">
          <Camera size={56} className="text-slate-300 mb-4" />
          <p className="text-base font-bold text-slate-700">UAUC Capture</p>
          <p className="text-xs text-slate-400 mt-1 text-center">Capture UAUC compliance findings</p>
        </div>
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)'}}>
          <div className="flex items-center justify-around py-1">
            {navTabs.map(tab => {
              const Icon = tab.icon;
              const isActiveTab = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => handleNav(tab.id)} className="flex flex-col items-center gap-0.5 min-w-[60px] py-1.5">
                  <div className={cn("flex items-center justify-center w-8 h-8 rounded-xl transition-all", isActiveTab && "bg-blue-50")}>


                    <Icon size={20} className={isActiveTab ? 'text-blue-600' : 'text-slate-400'} />
                  </div>
                  <span className={`text-[9px] font-semibold ${isActiveTab ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (isEHS && activeTab === 'home') {
    const ehsRecentSubmissions = items.slice(0, 8);
    return (
      <div className="fixed inset-0 z-[90] bg-[#F5F6F8] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-3 pb-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-0.5">{greeting}</p>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">{user.name} 👋</h1>
            <p className="text-xs text-slate-400 mt-0.5">EHS Engineer</p>
          </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <button onClick={onLogout} className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Logout">
                <LogOut size={20} />
              </button>
              <div className="w-[42px] h-[42px] rounded-full bg-blue-100 border-2 border-white shadow-sm overflow-hidden">
                <img src={`https://picsum.photos/seed/${user.name}/200/200`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
            </div>
          </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-28 space-y-6">
          {/* Today's Work */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-900">Today's Work</h2>
              <button onClick={() => { setActiveTab('my-tasks'); setStatusFilter('Awaiting Approval'); }} className="text-xs font-semibold text-blue-600">View All</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center mb-3 shadow-sm">
                  <ClipboardCheck size={20} className="text-white" />
                </div>
                <p className="text-2xl font-bold text-slate-900">{pendingReviewCount}</p>
                <p className="text-sm font-semibold text-slate-700 mt-1">Pending Review</p>
                <span className="inline-block mt-1.5 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold">Priority Action</span>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mb-3 shadow-sm">
                  <CheckCircle2 size={20} className="text-white" />
                </div>
                <p className="text-2xl font-bold text-slate-900">{approvedTodayCount}</p>
                <p className="text-sm font-semibold text-slate-700 mt-1">Approved Today</p>
                <span className="inline-block mt-1.5 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">Good Work</span>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center mb-3 shadow-sm">
                  <X size={20} className="text-white" />
                </div>
                <p className="text-2xl font-bold text-slate-900">{rejectedTodayCount}</p>
                <p className="text-sm font-semibold text-slate-700 mt-1">Rejected Today</p>
                <span className="inline-block mt-1.5 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">Need Attention</span>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-3 shadow-sm">
                  <BarChart3 size={20} className="text-white" />
                </div>
                <p className="text-2xl font-bold text-slate-900">{completedThisMonthCount}</p>
                <p className="text-sm font-semibold text-slate-700 mt-1">Completed This Month</p>
                <span className="inline-block mt-1.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">Above Improved</span>
              </div>
            </div>
          </div>

          {/* Recent Submissions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-900">Recent Submissions</h2>
              <button onClick={() => { setActiveTab('my-tasks'); }} className="text-xs font-semibold text-blue-600">View All</button>
            </div>
            <div className="space-y-3">
              {ehsRecentSubmissions.length > 0 ? ehsRecentSubmissions.map((s, i) => {
                const ehsStatusKey = s.status === 'AWAITING_APPROVAL' ? 'Awaiting Approval' : (s.status === 'ACCEPTED' || s.status === 'CLOSED' ? 'Approved' : (s.status === 'REJECTED' || s.status === 'REWORK_REQUIRED' ? 'Rework Required' : (s.status === 'OPEN' ? 'Open' : s.status || 'Awaiting Approval')));
                const statusColors: Record<string, string> = { 'Awaiting Approval': 'bg-purple-100 text-purple-700', 'Approved': 'bg-emerald-100 text-emerald-700', 'Rework Required': 'bg-red-100 text-red-700', 'Open': 'bg-orange-100 text-orange-700' };
                const subTime = s.submittedOn || (s.closure_se_date ? new Date(s.closure_se_date + 'T' + (s.closure_se_time || '00:00')).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '') || s.raisedOn || '';
                const sIssueCount = s.issues_count || s.issuesFixed || s.safety_issues?.length || 0;
                return (
                  <div key={s.id || i} onClick={() => onEhsReview?.(s)} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 flex items-center gap-3 cursor-pointer active:bg-slate-50 transition-colors">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                      {s.image_url ? (
                        <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-slate-400">{(s.audit_id || s.uaucId || '--').slice(-3)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{s.location || s.project || '--'}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{s.audit_id || s.uaucId || ''} • {sIssueCount} {sIssueCount === 1 ? 'Issue' : 'Issues'}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{subTime}</p>
                    </div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 whitespace-nowrap ${statusColors[ehsStatusKey] || 'bg-slate-100 text-slate-700'}`}>{ehsStatusKey}</span>
                  </div>
                );
              }) : (
                <div className="py-8 text-center">
                  <FileText size={36} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-500">No submissions yet</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)'}}>
          <div className="flex items-center justify-around py-1">
            {navTabs.map(tab => {
              const Icon = tab.icon;
              const isActiveTab = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => handleNav(tab.id)} className="flex flex-col items-center gap-0.5 min-w-[60px] py-1.5">
                  <div className={cn("flex items-center justify-center w-8 h-8 rounded-xl transition-all", isActiveTab && "bg-blue-50")}>
                    <Icon size={20} className={isActiveTab ? 'text-blue-600' : 'text-slate-400'} />
                  </div>
                  <span className={`text-[9px] font-semibold ${isActiveTab ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'profile') {
    return (
      <div className="fixed inset-0 z-[90] bg-white flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 pt-14 pb-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <p className="text-xs text-slate-500">{greeting}</p>
                <h1 className="text-xl font-bold text-slate-900">Profile</h1>
              </div>
              <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-blue-200">
                {profileTabLabel}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-900">{user.name}</h2>
                <p className="text-sm text-slate-500 mt-1">{user.role === 'super_admin' ? 'Super Admin' : isEHS ? 'EHS Engineer' : 'Site Engineer'}</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Email Address</label>
                  <p className="text-sm font-medium text-slate-900">{user.mail_id || '--'}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">PS Number</label>
                  <p className="text-sm font-medium text-slate-900">{user.ps_number || '--'}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Project</label>
                  <p className="text-sm font-medium text-slate-900">{user.project_name || '--'}</p>
                </div>
              </div>
              <button onClick={onLogout} className="w-full mt-6 py-2.5 bg-red-50 text-red-600 text-sm font-bold rounded-xl flex items-center justify-center gap-2 border border-red-100">
                <LogOut size={16} /> Logout
              </button>
            </div>
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)'}}>
          <div className="flex items-center justify-around py-1">
            {navTabs.map(tab => {
              const Icon = tab.icon;
              const isActiveTab = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => handleNav(tab.id)} className="flex flex-col items-center gap-0.5 min-w-[60px] py-1.5">
                  <div className={cn("flex items-center justify-center w-8 h-8 rounded-xl transition-all", isActiveTab && "bg-blue-50")}>
                    <Icon size={20} className={isActiveTab ? 'text-blue-600' : 'text-slate-400'} />
                  </div>
                  <span className={`text-[9px] font-semibold ${isActiveTab ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── Site Engineer Home ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[90] bg-[#F5F6F8] flex flex-col">

        {/* Header */}
      <div className="flex items-start justify-between px-5 pb-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-500">{greeting}</p>
          <h1 className="text-xl font-bold text-slate-900 mt-0.5">{user.name}</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">Site Engineer</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <button onClick={onLogout} className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Logout">
            <LogOut size={20} />
          </button>
          <div className="w-[42px] h-[42px] rounded-full bg-blue-100 border-2 border-white shadow-sm overflow-hidden">
            <img src={`https://picsum.photos/seed/${user.name}/200/200`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-28 space-y-5">

        {/* ── Task Summary Card ── */}
        <div className="bg-[#EFF6FF] rounded-3xl p-5 shadow-sm border border-blue-100">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 flex items-center justify-center shrink-0">
              <ClipboardCheck size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">You have</p>
              <p className="text-2xl font-bold text-slate-900 -mt-0.5">{totalTasks} tasks due today.</p>
            </div>
          </div>
          <div className="space-y-2.5 pl-12">
            <div className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full border-2 border-blue-500 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              </div>
              <span className="text-xs text-slate-600 font-medium">{taskRequiresRework} require rework.</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full border-2 border-blue-500 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              </div>
              <span className="text-xs text-slate-600 font-medium">{taskAwaitingApproval} awaiting approval.</span>
            </div>
          </div>
        </div>

        {/* ── Continue Working ── */}
        {continueTask && (
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-3">Continue Working</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex gap-3 p-4">
                <div className="w-[88px] h-[88px] rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shrink-0 overflow-hidden flex items-center justify-center text-white">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="text-sm font-bold text-slate-900 truncate">{continueTask.location || continueTask.project || 'Project'}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{continueTask.uaucId || continueTask.audit_id || ''}</p>
                    </div>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0 ml-2">In Progress</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    {uaucSummary.open || 0} of {uaucSummary.open + uaucSummary.awaiting_approval || 0} Issues Completed
                  </p>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1.5">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, ((uaucSummary.open || 0) / Math.max(uaucSummary.open + uaucSummary.awaiting_approval || 1, 1)) * 100)}%` }} />
                  </div>
                  <button
                    onClick={() => onViewDetail?.(continueTask.id)}
                    className="w-full mt-3 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                  >
                    Continue <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Recent Assigned Tasks ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-slate-900">Recent Assigned Tasks</h2>
            <button onClick={() => { setActiveTab('my-tasks'); }} className="text-xs font-semibold text-blue-600">View All</button>
          </div>
          <div className="space-y-3">
            {recentTasks.length > 0 ? recentTasks.slice(0, 3).map((s, i) => {
              const statusKey = normalizeStatus(s.status || 'Open');
              const statusCfg = statusConfig[statusKey] || { label: 'Open', bg: 'bg-orange-100', text: 'text-orange-700' };
              return (
                <div key={s.id || i} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 flex items-center gap-3 cursor-pointer active:bg-slate-50 transition-colors" onClick={() => onViewDetail?.(s.id)}>
                  <div className="w-[52px] h-[52px] rounded-xl bg-slate-100 shrink-0 overflow-hidden">
                    {s.image_url ? (
                      <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
                        <span className="text-xs font-bold text-slate-400">{(s.audit_id || s.uaucId || '--').slice(-3)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{s.location || s.project || ''}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{s.uaucId || s.audit_id || ''}</p>
                  </div>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${statusCfg.bg} ${statusCfg.text}`}>
                    {statusCfg.label}
                  </span>
                </div>
              );
            }) : (
              <p className="text-sm text-slate-400 text-center py-6">No recent tasks assigned.</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2" style={{paddingBottom: 'env(safe-area-inset-bottom, 8px)'}}>
        <div className="flex items-center justify-around py-1">
          {navTabs.map(tab => {
            const Icon = tab.icon;
            const isActiveTab = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => handleNav(tab.id)} className="flex flex-col items-center gap-0.5 min-w-[60px] py-1.5">
                <div className={cn("flex items-center justify-center w-8 h-8 rounded-xl transition-all", isActiveTab && "bg-blue-50")}>
                  <Icon size={20} className={isActiveTab ? 'text-blue-600' : 'text-slate-400'} />
                </div>
                <span className={`text-[9px] font-semibold ${isActiveTab ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Searchable dropdown / combo-box
// ---------------------------------------------------------------------------
function SearchableSelect({ label, value, setter, options, required = true, mobile = false, searchPlaceholder = "Search..." }: {
  label: string;
  value: string;
  setter: (v: string) => void;
  options: string[];
  required?: boolean;
  mobile?: boolean;
  searchPlaceholder?: string;
}) {
  const [search, setSearch] = useState('');
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const styles = mobile ? {
    wrapper: 'h-[44px] rounded-xl',
    input: 'h-[44px] rounded-xl',
    list: 'rounded-xl',
  } : {
    wrapper: 'h-10 rounded-lg',
    input: 'h-10 rounded-lg',
    list: 'rounded-lg',
  };
  return (
    <label className="space-y-1.5">
      <span className={cn("font-semibold mb-1 block", mobile ? "text-xs text-slate-600" : "text-xs font-bold text-slate-700")}>
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      <details className="relative group" onToggle={(e) => { if (!(e.target as HTMLDetailsElement).open) setSearch(''); }}>
        <summary className={cn(
          "list-none w-full px-3 bg-white border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none cursor-pointer flex items-center justify-between gap-2",
          styles.wrapper
        )}>
          <span className="truncate">{value}</span>
          <ChevronRight size={mobile ? 16 : 14} className="rotate-90 text-slate-400 shrink-0" />
        </summary>
        <div className={cn("absolute z-50 mt-1 w-full border border-slate-200 bg-white shadow-xl", styles.list)}>
          <div className="p-2 border-b border-slate-100">
            <SpeechInput value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/20"
              onClick={(e) => e.stopPropagation()} />
          </div>
          <div className="max-h-36 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">No matches found</div>
            ) : filtered.map((option, idx) => (
              <button key={`${option}-${idx}`} type="button"
                onClick={(e) => { setter(option); setSearch(''); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-blue-50", value === option ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700")}>{option}</button>
            ))}
          </div>
        </div>
      </details>
    </label>
  );
}

// --- Global fetch interceptor for JWT auth ---
// Attaches Authorization: Bearer <token> to all /api/ requests automatically.
// Runs once at module load, before any React component renders.
(function _setupAuthFetch() {
  const _origFetch = window.fetch;
  (window as any).fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const stored = localStorage.getItem('sitemonitor_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && u.access_token && typeof input === 'string' && (input.startsWith('/api/') || input.startsWith('/chat-api/'))) {
          const h = new Headers(init?.headers);
          if (!h.has('Authorization')) {
            h.set('Authorization', `Bearer ${u.access_token}`);
          }
          init = { ...init, headers: h };
        }
      }
    } catch { /* token read failure — proceed unauthenticated */ }
    return _origFetch.call(window, input, init);
  };
})();

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<{ ps_number: string; role: 'ehs' | 'site' | 'super_admin' | 'sbg'; name: string; mail_id: string; project_name: string; sbg: string; bu: string; access_token?: string } | null>(() => {
    try {
      const stored = localStorage.getItem('sitemonitor_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const handleLogin = useCallback((loggedInUser: { ps_number: string; role: 'ehs' | 'site' | 'super_admin' | 'sbg'; name: string; mail_id: string; project_name: string; sbg: string; bu: string; access_token?: string }) => {
    setUser(loggedInUser);
    localStorage.setItem('sitemonitor_user', JSON.stringify(loggedInUser));
    if (window.innerWidth < 768) {
      setActivePage('mobile-workspace-loader');
    } else {
      if (loggedInUser.role === 'ehs') setActivePage('my-tasks-init');
      else if (loggedInUser.role === 'site') setActivePage('site-dashboard');
      else if (loggedInUser.role === 'sbg' || loggedInUser.sbg.trim().toLowerCase() === 'y') setActivePage('project-dashboard');
      else setActivePage('my-uaucs');
    }
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('sitemonitor_user');
    clearCache();
    setActivePage('dashboard');
  }, []);

  const [activePage, setActivePage] = useState<Page>(() => {
    if (user && window.innerWidth < 768) return 'mobile-home';
    return 'dashboard';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCamera, setSelectedCamera] = useState<any | null>(null);
  const [selectedActivityLog, setSelectedActivityLog] = useState<ActivityLog | null>(null);
  const [showAI, setShowAI] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [geminiAnalysis, setGeminiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadProgressRef = useRef<number>(0);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedIssueIndices, setSelectedIssueIndices] = useState<Set<number>>(new Set());
  const [auditDisplayId, setAuditDisplayId] = useState('');
  const [savingAudit, setSavingAudit] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraCaptureRef = useRef<HTMLInputElement>(null);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [selectedUaucId, setSelectedUaucId] = useState<number | null>(null);
  const [closureSubmissions, setClosureSubmissions] = useState<any[]>([]);
  const [selectedApprovalItem, setSelectedApprovalItem] = useState<any | null>(null);
  const approvalListRef = useRef<any[]>([]);
  const mobileHomeDefaultTabRef = useRef<string>('');
  const mobileHomeDefaultStatusFilterRef = useRef<string>('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileAuditStep, setMobileAuditStep] = useState<'form' | 'analyzing' | 'report'>('form');
  const [uaucSavedToast, setUaucSavedToast] = useState(false);
  const [editingReport, setEditingReport] = useState(false);
  const [editedIssues, setEditedIssues] = useState<any[]>([]);
  const [editedRecs, setEditedRecs] = useState<string[]>([]);

  // Stable callbacks for memoized page components
  const handleBackToMyUaucs = useCallback(() => {
    if (isMobile) {
      setActivePage('mobile-workspace-loader');
    } else {
      setActivePage(user?.role === 'super_admin' ? 'executive-dashboard' : user?.role === 'ehs' ? 'my-tasks-init' : (user?.role === 'sbg' || user?.sbg?.trim().toLowerCase() === 'y') ? 'project-dashboard' : 'my-uaucs');
    }
  }, [user, isMobile]);
  const handleBackToMyTasks = useCallback(() => {
    if (isMobile) {
      setActivePage('mobile-home');
    } else {
      setActivePage('my-tasks-init');
    }
  }, [isMobile]);
  const handleReviewSubmission = useCallback((item: any, list?: any[]) => {
    setSelectedApprovalItem(item);
    if (list) {
      approvalListRef.current = list.filter((s: any) => s.status === 'Awaiting Approval');
    }
    if (window.innerWidth < 768) mobileHomeDefaultTabRef.current = 'my-tasks';
    setActivePage('uauc-approval');
  }, []);
  const handleApprovalComplete = useCallback((currentItemId?: number) => {
    const list = approvalListRef.current;
    if (list.length > 0) {
      const currentIdx = list.findIndex((s: any) => s.id === currentItemId);
      if (currentIdx >= 0 && currentIdx < list.length - 1) {
        setSelectedApprovalItem(list[currentIdx + 1]);
        return;
      }
    }
    if (window.innerWidth < 768) {
      mobileHomeDefaultTabRef.current = 'my-tasks';
      setActivePage('mobile-home');
    } else {
      setActivePage('my-tasks-init');
    }
  }, []);

  const handleEhsViewDetail = useCallback((item: any) => {
    const id = item.id ?? (item.uaucId ? parseInt(item.uaucId.replace(/\D/g, ''), 10) || null : null);
    if (id) {
      setSelectedUaucId(id);
      setActivePage('my-uaucs-detail');
    }
  }, []);
  const handleSiteViewDetail = useCallback((id: number) => {
    setSelectedUaucId(id);
    setActivePage(isMobile ? 'uauc-closure' : 'demo');
  }, [isMobile]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile]);

  const openCamera = () => {
    setCameraPermissionError(null);
    if (navigator.mediaDevices?.getUserMedia && window.isSecureContext) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
        .then((stream) => {
          if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(t => t.stop());
          }
          cameraStreamRef.current = stream;
          setShowCamera(true);
        })
        .catch((err: any) => {
          console.error('Camera error:', err);
          const name = err?.name || '';
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            setCameraPermissionError('Camera permission denied. Please allow camera access in your browser settings.');
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            triggerCameraCapture();
          } else if (name === 'NotReadableError') {
            setCameraPermissionError('Camera is in use by another application.');
          } else {
            triggerCameraCapture();
          }
        });
    } else {
      triggerCameraCapture();
    }
  };

  const triggerCameraCapture = () => {
    cameraCaptureRef.current?.click();
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
    e.target.value = '';
  };

  const handleCancelReport = () => {
    setMobileAuditStep('form');
    setUploadResult(null);
    setSelectedFile(null);
    setAuditDisplayId('');
    setSelectedIssueIndices(new Set());
  };

  const handleBackFromAnalysis = () => {
    setMobileAuditStep('form');
  };

  useEffect(() => {
    if (showCamera && cameraStreamRef.current && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStreamRef.current;
    }
    if (!showCamera && cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
  }, [showCamera]);

  useEffect(() => {
    if (!cameraPermissionError) return;
    const timer = setTimeout(() => setCameraPermissionError(null), 8000);
    return () => clearTimeout(timer);
  }, [cameraPermissionError]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mobileAuditStep]);

  useEffect(() => {
    if (mobileAuditStep === 'analyzing' && !uploadingVideo && uploadResult) {
      setMobileAuditStep('report');
    }
    if (mobileAuditStep === 'analyzing' && !uploadingVideo && uploadError) {
      setMobileAuditStep('form');
    }
  }, [uploadResult, uploadError, uploadingVideo, mobileAuditStep]);

  useEffect(() => {
    let cancelled = false;
    const match = window.location.pathname.match(/^\/download-audit\/(.+)/);
    if (match) {
      const auditId = match[1];
      fetch(`/api/download-audit-pdf/${auditId}`)
        .then(res => {
          if (!res.ok) throw new Error('PDF not found');
          return res.blob();
        })
        .then(blob => {
          if (cancelled) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `Audit_Report_${auditId}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(a.href);
        })
        .catch(err => { if (!cancelled) console.warn('Auto-download failed:', err); });
    }
    return () => { cancelled = true; };
  }, []);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const previewUrl = useMemo(() => selectedFile ? URL.createObjectURL(selectedFile) : '', [selectedFile]);
  const prevPreviewUrl = useRef('');
  useEffect(() => {
    if (prevPreviewUrl.current && prevPreviewUrl.current !== previewUrl) {
      URL.revokeObjectURL(prevPreviewUrl.current);
    }
    prevPreviewUrl.current = previewUrl;
  }, [previewUrl]);
  const [auditProject, setAuditProject] = useState(user?.project_name || '');
  useEffect(() => {
    if (user?.ps_number) {
      fetch(`/api/auth/user-project?ps_number=${encodeURIComponent(user.ps_number)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.project_name) setAuditProject(data.project_name); })
        .catch(() => {});
    }
  }, [user?.ps_number]);
  const [auditActivity, setAuditActivity] = useState('Asphalt Laying Activity');
  const [auditSubActivity, setAuditSubActivity] = useState('');
  const [auditLocation, setAuditLocation] = useState('');
  const [auditRemarks, setAuditRemarks] = useState('');
  const auditInspectorName = (user?.role === 'ehs' || user?.role === 'super_admin') ? user.name : '';
  const [auditTargetDate, setAuditTargetDate] = useState('');
  const targetDateRef = useRef<HTMLInputElement>(null);
  const [siteEngineerOptions, setSiteEngineerOptions] = useState<string[]>([]);
  const [siteEngineerEmails, setSiteEngineerEmails] = useState<Record<string, string>>({});
  const [auditSiteEngineer, setAuditSiteEngineer] = useState('');

  const resetAuditForm = useCallback(() => {
    setUploadResult(null);
    setSelectedFile(null);
    setAuditDisplayId('');
    setSelectedIssueIndices(new Set());
    setAuditSubActivity('');
    setAuditLocation('');
    setAuditRemarks('');
    setAuditTargetDate('');
    setAuditSiteEngineer('');
    setAuditActivity('Asphalt Laying Activity');
    setUploadError(null);
    setSavingAudit(false);
    setEditingReport(false);
    setEditedIssues([]);
    setEditedRecs([]);
    setShowCamera(false);
    setCameraPermissionError(null);
    setMobileAuditStep('form');
  }, []);

  useEffect(() => {
    if (activePage === 'audit') {
      resetAuditForm();
    }
  }, [activePage, resetAuditForm]);

  useEffect(() => {
    fetch(`/api/auth/site-engineers`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const names = data.map((e: any) => e.employee_name);
        const emails: Record<string, string> = {};
        data.forEach((e: any) => { emails[e.employee_name] = e.mail_id; });
        setSiteEngineerOptions(names);
        setSiteEngineerEmails(emails);
        if (names.length) setAuditSiteEngineer(names[0]);
      })
      .catch(() => {});
  }, [auditProject]);

  useEffect(() => {
    if (user?.role === 'site' && siteEngineerOptions.length) {
      if (siteEngineerOptions.includes(user.name)) {
        setAuditSiteEngineer(user.name);
      }
    }
  }, [user, siteEngineerOptions]);
  const [activeModules, setActiveModules] = useState<Record<string, boolean>>({
    'Helmet Detection': true,
    'Vest Detection': true,
    'Boot Detection': true,
    'Phone Detection': true,
    'Danger Zone': true,
    'Precast Objects': true,
  });
  const [incidents, setIncidents] = useState<any[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [allLogsData, setAllLogsData] = useState<ActivityLog[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [oneDriveConnected, setOneDriveConnected] = useState(false);

  const handleDecision = useCallback(async (uaucId: string, status: 'accepted' | 'rejected', comment: string, unresolvedIssues?: string) => {
    const dbId = selectedApprovalItem?.id;
    if (dbId) {
      const resp = await authFetch(`/api/uaucs/${dbId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: status, comment, rejected_by: auditInspectorName, unresolved_issues: unresolvedIssues || null }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${resp.status})`);
      }
    }
    setClosureSubmissions(prev => {
      const existingIdx = prev.findIndex(s => s.id === selectedApprovalItem?.id || s.uaucId === uaucId);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = { ...next[existingIdx], status: status === 'accepted' ? 'Approved' : 'Rework Required' };
        return next;
      }
      if (selectedApprovalItem) {
        return [...prev, { ...selectedApprovalItem, uaucId: uaucId || selectedApprovalItem.uaucId, status: status === 'accepted' ? 'Approved' : 'Rework Required' }];
      }
      return prev;
    });
  }, [selectedApprovalItem, auditInspectorName, setClosureSubmissions]);

  const handleClosureSubmitted = useCallback((data: any) => {
    setClosureSubmissions(prev => {
      const existing = prev.findIndex(s => s.id === data.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], ...data, status: 'Awaiting Approval' };
        return next;
      }
      return [data, ...prev];
    });
  }, [setClosureSubmissions]);

  // Custom Chart Builder State
  const [customChartType, setCustomChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [customChartMetric, setCustomChartMetric] = useState<'incidents' | 'workers' | 'danger_zones' | 'ppe_violations' | 'response_time'>('incidents');
  const [customChartTitle, setCustomChartTitle] = useState('My Custom Safety Visual');
  const [incidentTimePeriod, setIncidentTimePeriod] = useState<'week' | 'month' | 'year'>('week');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  // Analytics Data State
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [modulePerformance, setModulePerformance] = useState<any[]>([]);
  const [activityTrends, setActivityTrends] = useState<any>(null);
  const [zoneRisk, setZoneRisk] = useState<any[]>([]);
  const [insightsData, setInsightsData] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [cameraModalError, setCameraModalError] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Camera State - all in one place
  const [cameras, setCameras] = useState<any[]>([]);
  const [camerasLoading, setCamerasLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [dashCameras, setDashCameras] = useState<any[]>([]);
  const [execCameras, setExecCameras] = useState<any[]>([]);
  const [snapshotTs, setSnapshotTs] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setSnapshotTs(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch cameras on mount
  useEffect(() => {
    let cancelled = false;
    const fetchCameras = async () => {
      try {
        const res = await fetch('/api/stream/cameras');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setCameras(data);
            setDashCameras(data.slice(0, 4));
            setExecCameras(data.slice(0, 4));
            // Auto-expand first project
            if (data.length > 0) {
              const projects = [...new Set(data.map((c: any) => c.project))];
              if (projects.length > 0 && projects[0]) setExpandedProject(projects[0] as string);
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch cameras:', e);
      } finally {
        if (!cancelled) setCamerasLoading(false);
      }
    };
    fetchCameras();
    return () => { cancelled = true; };
  }, []);

  // Fetch analytics data on mount
  useEffect(() => {
    let cancelled = false;
    const fetchAnalyticsData = async () => {
      try {
        const [weeklyRes, moduleRes, activityRes, zoneRes] = await Promise.all([
          fetch('/api/analytics/weekly-data'),
          fetch('/api/analytics/module-performance'),
          fetch('/api/analytics/activity-trends'),
          fetch('/api/analytics/zone-risk')
        ]);
        
        if (!cancelled) {
          if (weeklyRes.ok) setWeeklyData(await weeklyRes.json());
          if (moduleRes.ok) setModulePerformance(await moduleRes.json());
          if (activityRes.ok) setActivityTrends(await activityRes.json());
          if (zoneRes.ok) setZoneRisk(await zoneRes.json());
        }
      } catch (error) {
        if (!cancelled) console.error('Error fetching analytics data:', error);
      }
    };
    fetchAnalyticsData();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ONEDRIVE_AUTH_SUCCESS') {
        setOneDriveConnected(true);
        // Optionally store tokens in localStorage
        console.log('OneDrive Connected:', event.data.tokens);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async (useCache = true) => {
      try {
        const TTL = 30_000;
        const [incs, stats, safetyStats, logsData] = await Promise.all([
          cachedFetch('/api/incidents?limit=50', { ttl: TTL, skipCache: !useCache }),
          cachedFetch('/api/analytics/summary', { ttl: TTL, skipCache: !useCache }),
          cachedFetch('/api/safety-model/stats', { ttl: TTL, skipCache: !useCache }),
          cachedFetch('/api/activity-logs?limit=50', { ttl: TTL, skipCache: !useCache }),
        ]);
        if (cancelled) return;
        setIncidents(incs || []);
        setIncidentsLoading(false);
        setAnalytics(stats);
        setStats(safetyStats);
        const logs = logsData.data || [];
        setAllLogsData(logs);
        if (activityLogs.length === 0) {
          setActivityLogs(logs);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        if (!cancelled) {
          setIncidentsLoading(false);
          setIncidentsError('Failed to fetch data from server');
        }
      }
    };
    // Try cache first for instant render, then refresh from network
    fetchData(true).catch(() => fetchData(false));
    if (!activityLogs.length || !incidents.length) fetchData(false);

    // Adaptive polling: slower on poor connections
    const getPollInterval = () => {
      try {
        const conn = (navigator as any).connection?.effectiveType;
        if (!conn || conn === '4g') return 15000;
        if (conn === '3g') return 30000;
        return 60000;
      } catch { return 15000; }
    };

    const poll = async () => {
      if (document.hidden) return;
      const TTL = 30_000;
      try {
        const [incs, analytics, safetyStats] = await Promise.all([
          cachedFetch('/api/incidents?limit=50', { ttl: TTL, skipCache: true }),
          cachedFetch('/api/analytics/summary', { ttl: TTL, skipCache: true }),
          cachedFetch('/api/safety-model/stats', { ttl: TTL, skipCache: true }),
        ]);
        if (cancelled) return;
        setIncidents(incs || []);
        setAnalytics(analytics);
        setStats(safetyStats);
      } catch (error) {
        console.error('Error polling data:', error);
      }
    };
    const interval = setInterval(poll, getPollInterval());
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (activePage !== 'activity-analytics') return;
    const fetchInsights = async () => {
      setInsightsLoading(true);
      try {
        const res = await fetch('/api/activity-insights/summary');
        if (!cancelled && res.ok) setInsightsData(await res.json());
      } catch (error) {
        if (!cancelled) console.error('Error fetching insights:', error);
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    };
    fetchInsights();
    return () => { cancelled = true; };
  }, [activePage]);

  const [showAddCameraModal, setShowAddCameraModal] = useState(false);

  const fetchIncidents = async () => {
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const res = await fetch('/api/incidents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('Incidents API response:', data);
      setIncidents(data);
    } catch (err: any) {
      console.error('Error fetching incidents:', err);
      setIncidentsError(err.message || 'Failed to fetch incidents');
    } finally {
      setIncidentsLoading(false);
    }
  };

  const fetchActivityLogsPage = async (page: number = 1) => {
    setLogsLoading(true);
    try {
      const skip = (page - 1) * rowsPerPage;
      let url = `/api/activity-logs?limit=${rowsPerPage}&skip=${skip}`;
      if (logsSelectedProject !== 'All') url += `&project=${logsSelectedProject}`;
      if (logsSelectedZone !== 'All') url += `&zone=${logsSelectedZone}`;
      if (logsStartDate) url += `&start_date=${logsStartDate}`;
      if (logsEndDate) url += `&end_date=${logsEndDate}`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setActivityLogs(data.data || []);
      setLogsTotalRecords(data.total || 0);
      setLogsTotalIdleSeconds(data.totalIdleSeconds || 0);
      setCurrentLogsPage(page);
    } catch (err: any) {
      console.error('Error fetching activity logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const modalImageRef = useRef<HTMLImageElement>(null);

  const [riskFilter, setriskFilter] = useState<string>('All');
  const [moduleFilter, setModuleFilter] = useState<string>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [currentLogsPage, setCurrentLogsPage] = useState(1);
  const [logsTotalRecords, setLogsTotalRecords] = useState(0);
  const [logsTotalIdleSeconds, setLogsTotalIdleSeconds] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStartDate, setLogsStartDate] = useState('');
  const [logsEndDate, setLogsEndDate] = useState('');
  const [logsSelectedProject, setLogsSelectedProject] = useState('All');
  const [logsSelectedZone, setLogsSelectedZone] = useState('All');
  const [workTimeTooltip, setWorkTimeTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [analyticsFilter1, setAnalyticsFilter1] = useState('All');
  const [analyticsFilter2, setAnalyticsFilter2] = useState('All');
  const [analyticsFilter3, setAnalyticsFilter3] = useState('All');
  const [analyticsFilter4, setAnalyticsFilter4] = useState('All');
  const [analyticsFilter5, setAnalyticsFilter5] = useState('All Time');
  const rowsPerPage = 30;

  const filteredIncidents = useMemo(() => incidents.filter(incident => {
    const matchesSearch = 
      incident.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      incident.cameraZone.toLowerCase().includes(searchQuery.toLowerCase()) ||
      incident.unsafeActivity.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesrisk = riskFilter === 'All' || incident.risk.toLowerCase() === riskFilter.toLowerCase();
    const matchesModule = moduleFilter === 'All' || incident.unsafeActivity.toLowerCase() === moduleFilter.toLowerCase();

    return matchesSearch && matchesrisk && matchesModule;
  }), [incidents, searchQuery, riskFilter, moduleFilter]);

  // Pagination for incidents
  const totalPages = Math.ceil(filteredIncidents.length / rowsPerPage);
  const paginatedIncidents = useMemo(() => filteredIncidents.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  ), [filteredIncidents, currentPage, rowsPerPage]);

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handleLogsPageChange = (page: number) => {
    fetchActivityLogsPage(page);
  };

  useEffect(() => {
    fetchActivityLogsPage(1);
  }, [logsStartDate, logsEndDate, logsSelectedProject, logsSelectedZone]);

  const toggleModule = (name: string) => {
    setActiveModules(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const handleSnapshot = () => {
    if (selectedCamera && selectedCamera.videoUrl) {
      const link = document.createElement('a');
      link.download = `camera-snapshot-${selectedCamera.id}-${Date.now()}.jpg`;
      link.href = selectedCamera.videoUrl;
      link.click();
    }
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
    if (!isRecording) {
      // Start simulation
      console.log("Recording started...");
    } else {
      // Stop simulation
      alert("Recording saved to site-logs/recordings/");
    }
  };

  const runGeminiAudit = async (videoUrl: string) => {
    setIsAnalyzing(true);
    const result = await analyzePPECompliance(videoUrl);
    setGeminiAnalysis(result);
    setIsAnalyzing(false);
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploadingVideo(true);
    setUploadProgress(5);
    uploadProgressRef.current = 5;
    setUploadError(null);
    const progressTimer = setInterval(() => {
      const p = uploadProgressRef.current;
      if (p < 50) uploadProgressRef.current = p + 6;
      else if (p < 75) uploadProgressRef.current = p + 2;
      else if (p < 95) uploadProgressRef.current = p + 0.6;
      setUploadProgress(Math.min(uploadProgressRef.current, 95));
    }, 300);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('project', auditProject);
    formData.append('activity', auditActivity);
    formData.append('sub_activity', auditSubActivity);
    formData.append('location', auditLocation);
    formData.append('remarks', auditRemarks);
    formData.append('initiated_by', auditInspectorName);

    try {
      const response = await fetch('/api/upload-analysis', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail || `Upload failed with HTTP ${response.status}`);
      }
      const data = await response.json();
      setUploadResult(data);
      const issueCount = (data.analysis?.safety_issues_list || data.analysis?.violations || []).length;
      setSelectedIssueIndices(new Set(Array.from({ length: Math.max(issueCount, 1) }, (_, i) => i)));
      setAuditDisplayId('');
      try {
        const idResp = await fetch(`/api/next-audit-id?project=${encodeURIComponent(auditProject)}`);
        const idData = await idResp.json();
        setAuditDisplayId(idData.audit_display_id);
      } catch (_) {}
      await fetchIncidents();
      await fetchActivityLogsPage(currentLogsPage);
      clearInterval(progressTimer);
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(0), 800);
    } catch (error) {
      clearInterval(progressTimer);
      setUploadProgress(0);
      console.error('Upload error:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload analysis failed');
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleConnectOneDrive = async () => {
    try {
      const response = await fetch('/api/auth/onedrive/url');
      const { url } = await response.json();
      window.open(url, 'onedrive_auth', 'width=600,height=700');
    } catch (error) {
      console.error('Failed to get OneDrive auth URL:', error);
    }
  };

  const handleExportExcel = async () => {
    const dataToExport = filteredIncidents.map(inc => ({
      'Incident ID': inc.id,
      'Timestamp': inc.timestamp,
      'Camera Zone': inc.cameraZone,
      'Unsafe Activity': inc.unsafeActivity,
      'risk': inc.risk,
      'Local Image Path': inc.localPath || 'N/A',
      'OneDrive Link': inc.oneDriveUrl || 'N/A'
    }));

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Incidents");
    XLSX.writeFile(workbook, `Safety_Incidents_Log_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportPDF = async () => {
    if (filteredIncidents.length === 0) {
      alert('No incidents to export');
      return;
    }

    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      let yPos = 20;

      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Safety Incidents Report', 20, yPos);
      yPos += 10;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos);
      yPos += 10;
      pdf.text(`Total Incidents: ${filteredIncidents.length}`, 20, yPos);
      yPos += 15;

      for (let i = 0; i < Math.min(filteredIncidents.length, 10); i++) {
        const inc = filteredIncidents[i];

        if (yPos > 250) {
          pdf.addPage();
          yPos = 20;
        }

        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Incident #${inc.id}`, 20, yPos);
        yPos += 6;

        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Time: ${inc.timestamp} | Zone: ${inc.cameraZone} | Risk: ${inc.risk}`, 20, yPos);
        yPos += 5;
        pdf.text(`Activity: ${inc.unsafeActivity}`, 20, yPos);
        yPos += 10;

        pdf.setDrawColor(200, 200, 200);
        pdf.line(20, yPos, 190, yPos);
        yPos += 10;
      }

      if (filteredIncidents.length > 10) {
        pdf.setFontSize(10);
        pdf.text(`... and ${filteredIncidents.length - 10} more incidents in Excel export.`, 20, yPos);
      }

      pdf.save(`Safety_Incidents_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Failed to generate PDF report');
    }
  };

  const generateAuditPDF = async (auditId?: string): Promise<any | null> => {
    if (!uploadResult) return null;
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const ml = 15;
      const cw = pw - ml - ml;
      const maxY = ph - ml;

      const hex = (h: string) => ({ r:parseInt(h.slice(1,3),16), g:parseInt(h.slice(3,5),16), b:parseInt(h.slice(5,7),16) });
      const sf = (h: string) => { const c=hex(h); pdf.setFillColor(c.r,c.g,c.b); };
      const st = (h: string) => { const c=hex(h); pdf.setTextColor(c.r,c.g,c.b); };
      const sd = (h: string) => { const c=hex(h); pdf.setDrawColor(c.r,c.g,c.b); };
      const wrap = (txt: string, maxW: number) => {
        if (!txt) return [''];
        const words = txt.split(' ');
        const lines: string[] = [];
        let cur = '';
        for (const w of words) {
          const test = cur ? cur + ' ' + w : w;
          if (pdf.getTextWidth(test) > maxW && cur) { lines.push(cur); cur = w; }
          else cur = test;
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [''];
      };
      const linesFor = (txt: string, maxW: number) => wrap(txt, maxW).length;

      let imgBase64 = '';
      try {
        const imgUrl = uploadResult.annotatedMediaUrl || uploadResult.mediaUrl;
        if (imgUrl) { const r = await fetch(imgUrl); const b = await r.blob(); imgBase64 = await new Promise(res => { const rd = new FileReader(); rd.onloadend = () => res(rd.result as string); rd.readAsDataURL(b); }); }
      } catch (_) {}

      const sIssues: string[] = uploadResult?.analysis?.safety_issues_list || [];
      const rList: string[] = uploadResult?.analysis?.recommendations_list || [];
      const pRisks: string[] = uploadResult?.analysis?.possible_risks_list || [];
      const risk: string = uploadResult?.analysis?.risk || 'N/A';
      const rows = (sIssues.length ? sIssues : ['Safety issue detected']).map((iss: string, i: number) => ({ issue: iss, risk: pRisks[i] || risk || 'Review required' }));
      const recs = rList.length ? rList : ['Review the uploaded frame and follow site safety procedures.'];

      pdf.setFontSize(9); pdf.setFont('helvetica','normal');
      const baseIssuesText = rows.reduce((t, r) => t + Math.max(linesFor(String(r.issue), cw/2-8), linesFor(String(r.risk), cw/2-8)) * 5 + 2, 0);
      const baseRecsText = recs.reduce((t, rec) => t + linesFor(String(rec), cw-16) * 5 + 2, 0);
      const imgH = imgBase64 ? 85 : 30;
      const totalH = 18 + 4 + 8 + 20 + baseIssuesText + 8 + baseRecsText + 8 + imgH + 6 + 10;

      const scale = Math.min(1, maxY / Math.max(totalH, 1));

      const F = (v: number, s: number) => Math.max(v * s, 2.5);
      const LH = F(5, scale);
      const CH = F(20, scale);
      const IH = F(imgH, scale);
      const TH = F(6, scale);
      const SH = F(6, scale);
      const GH = F(4, scale);
      const BH = F(8, scale);
      const boxPad = F(4, scale);
      const fsTitle = Math.max(6, F(16, scale));
      const fsSub = Math.max(5, F(10, scale));
      const fsHd = Math.max(5, F(11, scale));
      const fsBd = Math.max(4, F(8, scale));
      const fsFt = Math.max(4, F(7, scale));

      let y = ml;

      pdf.setFontSize(fsTitle); pdf.setFont('helvetica','bold'); st('#1e3a5f');
      pdf.text('UAUC Capture Report', pw / 2, y, { align: 'center' });
      y += fsTitle * 0.5 + GH;

      sd('#1e3a5f'); pdf.setLineWidth(0.6); pdf.line(ml, y, pw - ml, y);
      y += GH;

      pdf.setFontSize(fsBd); pdf.setFont('helvetica','normal'); st('#475569');
      pdf.text(`Audit ID: ${auditDisplayId || 'PENDING'}  |  Project: ${uploadResult.project || 'N/A'}  |  ${new Date().toLocaleString()}`, pw / 2, y, { align: 'center' });
      y += BH;

      const halfGap = GH * 0.5;
      const cw2 = (cw - GH) / 2;
      const numFont = Math.max(6, F(16, scale));
      const labelFont = Math.max(4, F(8, scale));
      sf('#fef2f2'); sd('#fecaca'); pdf.setLineWidth(0.4);
      pdf.roundedRect(ml, y, cw2, CH, 1.5, 1.5, 'FD');
      st('#dc2626'); pdf.setFontSize(numFont); pdf.setFont('helvetica','bold');
      pdf.text(String(sIssues.length), ml + 4, y + CH - 7);
      st('#475569'); pdf.setFontSize(labelFont); pdf.setFont('helvetica','bold');
      pdf.text('Safety Issues Found', ml + 4, y + CH - 2);
      sf('#f0fdf4'); sd('#bbf7d0');
      pdf.roundedRect(ml + cw2 + GH, y, cw2, CH, 1.5, 1.5, 'FD');
      st('#16a34a'); pdf.setFontSize(numFont); pdf.setFont('helvetica','bold');
      pdf.text(String(rList.length), ml + cw2 + GH + 4, y + CH - 7);
      st('#475569'); pdf.setFontSize(labelFont); pdf.setFont('helvetica','bold');
      pdf.text('Recommendations', ml + cw2 + GH + 4, y + CH - 2);
      y += CH + BH;

      const halfW = cw / 2 - GH;
      pdf.setFontSize(fsHd); pdf.setFont('helvetica','bold'); st('#1e3a5f');
      pdf.text('Detected Safety Issues', ml, y); y += SH;
      sf('#f8fafc'); sd('#cbd5e1');
      pdf.rect(ml, y, cw, TH, 'F');
      st('#475569'); pdf.setFontSize(fsBd); pdf.setFont('helvetica','bold');
      const cx1 = ml + GH, cx2 = ml + cw / 2 + GH;
      pdf.text('Safety Issue', cx1, y + TH - 1); pdf.text('Potential Risk', cx2, y + TH - 1);
      y += TH;
      pdf.setFont('helvetica','normal'); pdf.setFontSize(fsBd);
      for (const row of rows) {
        const il = wrap(String(row.issue), halfW);
        const rl = wrap(String(row.risk), halfW);
        const nl = Math.max(il.length, rl.length);
        if (rows.indexOf(row) > 0) { sd('#e2e8f0'); pdf.line(ml, y, pw - ml, y); }
        for (let i = 0; i < nl; i++) {
          st('#dc2626'); if (i === 0) pdf.text('\u2022', cx1 - 2, y + LH - 1);
          st('#334155'); pdf.text(il[i] || '', cx1 + 2, y + LH - 1);
          st('#475569'); pdf.text(rl[i] || '', cx2 + 2, y + LH - 1);
          y += LH;
        }
        y += halfGap;
      }
      y += GH;

      pdf.setFontSize(fsHd); pdf.setFont('helvetica','bold'); st('#1e3a5f');
      pdf.text('AI Recommendations', ml, y); y += halfGap;
      let boxY = y;
      let boxH = boxPad;
      for (const rec of recs) { boxH += (linesFor(String(rec), cw - 12) || 1) * LH + halfGap; }
      boxH += boxPad;
      sf('#ffffff'); sd('#cbd5e1');
      pdf.roundedRect(ml, y, cw, boxH, 1.5, 1.5, 'FD');
      y += boxPad;
      pdf.setFont('helvetica','normal'); pdf.setFontSize(fsBd);
      for (const rec of recs) {
        const rlines = wrap(String(rec), cw - 12);
        for (let i = 0; i < rlines.length; i++) {
          st('#16a34a'); if (i === 0) pdf.text('\u2713', ml + GH, y + LH - 1);
          st('#334155'); pdf.text(rlines[i], ml + GH + 5, y + LH - 1);
          y += LH;
        }
        y += halfGap;
      }
      y = boxY + boxH + GH;

      pdf.setFontSize(fsHd); pdf.setFont('helvetica','bold'); st('#1e3a5f');
      pdf.text('Analyzed Image', ml, y); y += halfGap;
      if (imgBase64) {
        const imgDisplayH = Math.min(IH, maxY - y - GH - 6);
        sf('#f1f5f9'); pdf.rect(ml, y, cw, imgDisplayH, 'F');
        pdf.addImage(imgBase64, 'JPEG', ml, y, cw, imgDisplayH);
        y += imgDisplayH + GH;
      } else {
        sf('#f1f5f9'); sd('#cbd5e1'); pdf.rect(ml, y, cw, 20, 'F');
        st('#94a3b8'); pdf.setFontSize(fsBd); pdf.text('Image not available', pw / 2, y + 12, { align: 'center' });
        y += 24;
      }

      st('#94a3b8'); pdf.setFontSize(fsFt);
      pdf.text('Know Harm AI \u2014 UAUC Capture Report', pw / 2, ph - 6, { align: 'center' });

      return pdf;
    } catch (err) {
      console.error('Audit PDF generation failed:', err);
      return null;
    }
  };

  const onDownload = async (auditId?: string) => {
    const pdf = await generateAuditPDF(auditId);
    if (!pdf) return pdf;
    pdf.save(`Audit_Report_${auditId || new Date().toISOString().split('T')[0]}.pdf`);
    return pdf;
  };

  const onSaveAudit = async (auditId: string) => {
    // Email notifications are disabled. Keep this compatibility hook because
    // the audit-save flow still calls it after saving the audit record.
    void auditId;
  };

  const handleExportAuditPDF = async () => {
    await onDownload();
  };

  const handleSaveAudit = async () => {
    if (savingAudit) return;
    if (!uploadResult) return;
    if (!auditProject.trim()) { alert('Please select a Project'); return; }
    if (!auditActivity.trim()) { alert('Please select an Activity'); return; }
    if (!auditSubActivity.trim()) { alert('Please enter Sub Activity'); return; }
    if (!auditLocation.trim()) { alert('Please enter Location / Zone'); return; }
    if (!auditTargetDate) { alert('Please select a Target Date'); return; }
    if (!auditSiteEngineer) { alert('Please select a Site Engineer'); return; }
    if (!auditRemarks.trim()) { alert('Please enter a Brief Description'); return; }
    if (!selectedFile && !uploadResult?.mediaUrl) { alert('Please upload or capture a media file'); return; }
    setSavingAudit(true);
    const formData = new FormData();
    formData.append('project', auditProject);
    formData.append('activity', auditActivity);
    formData.append('sub_activity', auditSubActivity);
    formData.append('location', auditLocation);
    formData.append('remarks', auditRemarks);
    formData.append('initiated_by', auditInspectorName);
    formData.append('observation_date', new Date().toISOString().split('T')[0]);
    formData.append('observation_time', new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    formData.append('target_date', auditTargetDate);
    formData.append('site_engineer', auditSiteEngineer);
    const allIssues = editingReport ? editedIssues.map((r: any) => r.issue) : (uploadResult?.analysis?.safety_issues_list || uploadResult?.analysis?.violations || []);
    const allRisks = editingReport ? editedIssues.map((r: any) => r.risk) : (uploadResult?.analysis?.possible_risks_list || []);
    const selected = [...selectedIssueIndices].filter(i => i < allIssues.length).sort();
    const filteredIssues = selected.length > 0 ? selected.map(i => allIssues[i]) : allIssues;
    const filteredRisks = selected.length > 0 ? selected.map(i => allRisks[i] || '').filter(Boolean) : allRisks;
    formData.append('safety_issues', filteredIssues.join('\n'));
    formData.append('possible_risks', filteredRisks.join('\n'));
    formData.append('recommendations', editingReport ? editedRecs.join('\n') : (uploadResult?.analysis?.recommendations_list?.join('\n') || uploadResult?.analysis?.recommendation || ''));

    try {
      const imgUrl = uploadResult.annotatedMediaUrl || uploadResult.mediaUrl;
      if (imgUrl) {
        const imgResp = await fetch(imgUrl);
        const imgBlob = await imgResp.blob();
        formData.append('image_blob', imgBlob, 'audit_image.jpg');
      }

      const res = await fetch('/api/save-audit', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        const displayId = data.audit_display_id;
        setAuditDisplayId(displayId);
        setUaucSavedToast(true);
        setSavingAudit(false);

        setClosureSubmissions(prev => {
          if (prev.some(s => s.id === data.id)) return prev;
          return [{
            id: data.id,
            status: 'Open',
            uaucId: displayId,
            location: auditLocation,
            siteEngineer: auditSiteEngineer,
            initiatedBy: auditInspectorName,
            issuesFixed: filteredIssues.length,
            raisedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            submittedOn: '',
            targetDate: auditTargetDate ? new Date(auditTargetDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
            image_url: uploadResult?.annotatedMediaUrl || uploadResult?.mediaUrl || null,
            safety_issues: filteredIssues,
            after_images: [],
            targetDateRaw: auditTargetDate || '',
          }, ...prev];
        });

        onSaveAudit(displayId);
        setTimeout(() => {
          setUaucSavedToast(false);
          if (isMobile) {
            mobileHomeDefaultTabRef.current = 'my-tasks';
            mobileHomeDefaultStatusFilterRef.current = 'Awaiting Approval';
            resetAuditForm();
          }
          setActivePage(isMobile ? 'mobile-home' : 'dashboard');
        }, 1500);
      } else {
        const text = await res.text().catch(() => '');
        alert('Failed to save audit: ' + (text.slice(0, 300) || 'Unknown error'));
      }
    } catch (e) {
      alert('Failed to save audit: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setSavingAudit(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setActivePage('search-results');
    }
  };

  // Role-based page guard
  useEffect(() => {
    const adminOnly = ['admin'];
    const ehsOnly = ['audit', 'my-tasks-init', 'uauc-approval'];
    const siteOnly = ['my-uaucs', 'demo', 'uauc-closure', 'site-dashboard'];
    const dashboardOnly = ['project-dashboard', 'individual-dashboard'];
    const bothMobile = ['mobile-workspace-loader', 'mobile-home'];
    const denied = ['dashboard'];
    if (user?.role === 'super_admin') { /* can access everything except admin-only pages are super_admin only */ }
    else if (user?.role === 'ehs' && (siteOnly.includes(activePage) || adminOnly.includes(activePage) || denied.includes(activePage)) && !bothMobile.includes(activePage)) setActivePage('my-tasks-init');
    else if (user?.role === 'site' && (ehsOnly.includes(activePage) || adminOnly.includes(activePage) || denied.includes(activePage) || (dashboardOnly.includes(activePage) && user?.sbg?.trim().toLowerCase() !== 'y')) && !bothMobile.includes(activePage)) setActivePage('site-dashboard');
    else if (isDashRole && !['executive-dashboard', 'project-dashboard'].includes(activePage) && !bothMobile.includes(activePage)) setActivePage('project-dashboard');
  }, [activePage, user]);

  const renderContent = () => {
    switch (activePage) {
      case 'search-results':
        const filteredIncs = incidents.filter(i => 
          i.unsafeActivity.toLowerCase().includes(searchQuery.toLowerCase()) || 
          i.cameraZone.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.id.toLowerCase().includes(searchQuery.toLowerCase())
        );
        const filteredLogs = activityLogs.filter(l => 
          l.activity.toLowerCase().includes(searchQuery.toLowerCase()) || 
          (l.id && l.id.toLowerCase().includes(searchQuery.toLowerCase()))
        );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800">Search Results</h1>
          <p className="text-sm text-slate-500 mt-1">Found {filteredIncs.length} incidents and {filteredLogs.length} logs</p>
        </div>
              <button 
                onClick={() => {setSearchQuery(''); setActivePage('dashboard');}}
                className="text-sm font-bold text-blue-600 hover:text-blue-700"
              >
                Clear Search
              </button>
            </div>



            {filteredIncs.length > 0 && (
              <section>
                <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <AlertTriangle size={20} className="text-rose-500" />
                  Incidents ({filteredIncs.length})
                </h3>
                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Incident</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIncs.map(incident => (
                        <tr key={incident.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-slate-900">{incident.unsafeActivity}</p>
                            <p className="text-xs text-slate-500 truncate max-w-xs">{incident.id}</p>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">{incident.cameraZone}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{incident.timestamp}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              incident.risk === 'critical' ? "bg-rose-100 text-rose-600" :
                              incident.risk === 'high' ? "bg-orange-100 text-orange-600" :
                              "bg-blue-100 text-blue-600"
                            )}>
                              {incident.risk}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {filteredLogs.length > 0 && (
              <section>
                <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <History size={20} className="text-emerald-500" />
                  Activity Logs ({filteredLogs.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredLogs.map((log, idx) => (
                    <div key={`fl-${idx}`} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 overflow-hidden">
                        <img src={log.imageUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{formatActivity(log.activity)}</p>
                        <p className="text-xs text-slate-500">{log.cameraZone} · {log.time}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full uppercase tracking-wider">
                          {log.action}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {filteredIncs.length === 0 && filteredLogs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Search size={48} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No results found for "{searchQuery}"</p>
                <p className="text-sm">Try searching for keywords like "PPE", "Zone", "Worker", or "Crane".</p>
              </div>
            )}
          </div>
        );
      case 'profile':
        return (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex items-center gap-6">
              <div className="w-32 h-32 rounded-3xl bg-slate-100 border-4 border-white shadow-xl overflow-hidden shrink-0">
                <img src="https://picsum.photos/seed/manager/200/200" alt="Profile" loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div>
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{user?.name || 'User'}</h2>
                <p className="text-lg text-slate-500">{user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'ehs' ? 'EHS Engineer' : 'Site Engineer'}</p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 space-y-6">
              <h3 className="text-lg font-bold text-slate-900">Personal Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Email Address</label>
                  <p className="text-sm font-medium text-slate-900">{user?.mail_id || '--'}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">PS Number</label>
                  <p className="text-sm font-medium text-slate-900">{user?.ps_number || '--'}</p>
                </div>
              </div>
            </div>
          </div>
        );
      case 'admin':
        return <AdminPage userRole={user?.role || ''} />;
      case 'project-dashboard':
        return <SBGDashboard user={user!} />;
      case 'individual-dashboard':
        return <IndividualDashboard user={user!} />;
      case 'site-dashboard':
        return <SiteEngineerDashboard user={user!} />;
      case 'supervision':
        return <SupervisionPage 
          setSelectedCamera={setSelectedCamera}
          cameras={cameras}
          camerasLoading={camerasLoading}
        />;
      case 'dashboard':
        return (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Executive Dashboard</h1>
                <p className="text-slate-500 text-sm">Real-time overview of site safety, live feeds, and critical incidents</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-200">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">All Systems Active</span>
                </div>
              </div>
            </div>
            
            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 hover:shadow-md transition-all">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Today</p>
                <p className="text-2xl font-black text-blue-600">{incidents.filter(i => i.timestamp?.includes(new Date().toISOString().split('T')[0])).length}</p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 hover:shadow-md transition-all">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active Zones</p>
                <p className="text-2xl font-black text-emerald-600">{new Set(incidents.map(i => i.cameraZone)).size}</p>
              </div>
            </div>
            
            {/* Live Cameras + Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Live Camera Feeds */}
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-900">Live Camera Feeds</h2>
                    <button 
                      onClick={() => setActivePage('supervision')}
                      className="text-sm text-blue-600 font-medium hover:underline"
                    >
                      View All Feeds →
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {dashCameras.map((cam: any) => (
                      <DashCameraCard
                        key={cam.id}
                        cam={cam}
                        snapshotTs={snapshotTs}
                        onSelect={() => setSelectedCamera({ 
                          id: cam.id, 
                          name: cam.name, 
                          zone: cam.zone, 
                          project: cam.project,
                          type: 'static', 
                          videoUrl: `/api/stream/${cam.id}` 
                        })}
                      />
                    ))}
                    {dashCameras.length === 0 && (
                      <div className="col-span-2 text-center py-8 text-slate-400">
                        <Video size={48} className="mx-auto mb-2 opacity-20" />
                        <p className="text-xs">Loading cameras...</p>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Top Unsafe Activities from NLP */}
                {stats?.by_activity && stats.by_activity.length > 0 && (
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">Top Safety Violations</h2>
                    <div className="space-y-3">
                      {stats.by_activity.slice(0, 5).map((item: any, idx: number) => {
                        const maxCount = stats.by_activity[0]?.count || 1;
                        const percentage = (item.count / maxCount) * 100;
                        const getColor = (activity: string) => {
                          if (activity.includes('helmet')) return 'bg-orange-500';
                          if (activity.includes('vest')) return 'bg-blue-500';
                          if (activity.includes('boot')) return 'bg-amber-500';
                          return 'bg-rose-500';
          };

                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-700 flex items-center gap-1.5">
                                <span className="text-slate-400">{idx + 1}.</span>
                                {formatActivity(item.activity)}
                              </span>
                              <span className="font-bold text-slate-900">{item.count}</span>
                            </div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${getColor(item.activity)} transition-all duration-500`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Critical Incidents Sidebar */}
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-900">Critical Alerts</h2>
                    <button 
                      onClick={() => setActivePage('incidents')}
                      className="text-xs text-blue-600 font-bold hover:underline"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {incidents.filter(i => i.risk === 'high' || i.risk === 'critical').slice(0, 5).map((incident, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors cursor-pointer"
                        onClick={() => setActivePage('incidents')}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg shrink-0 flex items-center justify-center",
                            incident.risk === 'critical' ? "bg-rose-100 text-rose-600" : "bg-orange-100 text-orange-600"
                          )}>
                            <AlertTriangle size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-slate-900 truncate">{incident.unsafeActivity}</h4>
                            <p className="text-[10px] text-slate-500 truncate">{incident.cameraZone} · {incident.timestamp}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {incidents.filter(i => i.risk === 'high' || i.risk === 'critical').length === 0 && (
                      <div className="text-center py-6">
                        <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2 opacity-20" />
                        <p className="text-xs text-slate-400">No critical alerts</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Zone Risk Summary */}
                {stats?.by_zone && stats.by_zone.length > 0 && (
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">Zone Risk Summary</h2>
                    <div className="space-y-3">
                      {stats.by_zone.slice(0, 5).map((zone: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors">
                          <div className="flex items-center gap-2">
                            <Map size={14} className="text-slate-400" />
                            <span className="text-xs font-medium text-slate-700">{zone.zone}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">{zone.count}</span>
                            <div className={`w-2 h-2 rounded-full ${zone.count > 10 ? 'bg-rose-500' : zone.count > 5 ? 'bg-orange-500' : 'bg-emerald-500'}`} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      case 'safety-analytics':
        return <SafetyAnalyticsPage />;
      case 'executive-dashboard':
        return (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Executive Dashboard</h1>
                <p className="text-slate-500 text-sm">Real-time overview of site safety, live feeds, and critical incidents</p>
              </div>
            </div>

            {/* KPI Cards Row - Safety + Activity Combined */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Today', value: stats?.today_incidents ?? 0, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', icon: Clock },
                { label: 'Activities Tracked', value: allLogsData.length, color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-100', icon: Activity },
                { label: 'Active Zones', value: ((stats?.by_zone || []).length) || new Set(incidents.map(i => i.cameraZone)).size, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', icon: Map },
              ].map(({ label, value, color, bg, border, icon: Icon }) => (
                <div key={label} className={`p-4 ${bg} rounded-2xl border ${border} hover:shadow-md transition-all cursor-pointer`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
                    <Icon className={color} size={16} />
                  </div>
                  <p className={`text-2xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Live Cameras + Safety + Activity */}
              <div className="lg:col-span-2 space-y-4">
                {/* Live Camera Feeds */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-900">Live Camera Feeds</h2>
                    <button 
                      onClick={() => setActivePage('supervision')}
                      className="text-sm text-blue-600 font-medium hover:underline"
                    >
                      View All Feeds →
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {execCameras.map((cam: any) => (
                      <DashCameraCard
                        key={cam.id}
                        cam={cam}
                        snapshotTs={snapshotTs}
                        onSelect={() => setSelectedCamera({ 
                          id: cam.id, 
                          name: cam.name, 
                          zone: cam.zone, 
                          project: cam.project,
                          type: 'static', 
                          videoUrl: `/api/stream/${cam.id}` 
                        })}
                      />
                    ))}
                    {execCameras.length === 0 && (
                      <div className="col-span-2 text-center py-8 text-slate-400">
                        <Video size={48} className="mx-auto mb-2 opacity-20" />
                        <p className="text-xs">Loading cameras...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Safety + Activity Feed */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Top Safety Violations */}
                  {stats?.by_activity && stats.by_activity.length > 0 && (
                    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                      <h2 className="text-lg font-bold text-slate-900 mb-4">Top Safety Violations</h2>
                          <div className="space-y-3">
                        {stats.by_activity.slice(0, 5).map((item: any, idx: number) => {
                          const maxCount = stats.by_activity[0]?.count || 1;
                          const percentage = (item.count / maxCount) * 100;
                          return (
                            <div key={idx} className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-slate-700 flex items-center gap-1.5">
                                  <span className="text-slate-400">{idx + 1}.</span>
                                  {formatActivity(item.activity)}
                                </span>
                                <span className="font-bold text-slate-900">{item.count}</span>
                              </div>
                              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${idx === 0 ? 'bg-rose-500' : idx === 1 ? 'bg-orange-500' : idx === 2 ? 'bg-amber-500' : 'bg-slate-400'} transition-all duration-500`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recent Activities */}
                  {allLogsData.length > 0 && (
                    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                      <h2 className="text-lg font-bold text-slate-900 mb-4">Recent Activities</h2>
                      <div className="space-y-2 max-h-[320px] overflow-y-auto">
                        {allLogsData.slice(0, 10).map((log: any, idx: number) => (
                          <div key={`recent-${idx}`} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <Activity size={14} className="text-slate-400 shrink-0" />
                              <span className="text-xs font-medium text-slate-700 truncate">{formatActivity(log.activity)}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 shrink-0 ml-2">{log.zone} · {log.startTime?.split(' ')[0]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Critical Alerts + Zone Risk */}
              <div className="space-y-4">
                {/* Critical Alerts */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-900">Critical Alerts</h2>
                    <button 
                      onClick={() => setActivePage('incidents')}
                      className="text-xs text-blue-600 font-bold hover:underline"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {incidents.filter(i => i.risk === 'high' || i.risk === 'critical').slice(0, 5).map(incident => (
                      <div key={incident.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors cursor-pointer"
                        onClick={() => setActivePage('incidents')}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg shrink-0 flex items-center justify-center",
                            incident.risk === 'critical' ? "bg-rose-100 text-rose-600" : "bg-orange-100 text-orange-600"
                          )}>
                            <AlertTriangle size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-slate-900 truncate">{incident.unsafeActivity}</h4>
                            <p className="text-[10px] text-slate-500 truncate">{incident.cameraZone} · {incident.timestamp}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {incidents.filter(i => i.risk === 'high' || i.risk === 'critical').length === 0 && (
                      <div className="text-center py-6">
                        <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2 opacity-20" />
                        <p className="text-xs text-slate-400">No critical alerts</p>
                      </div>
                    )}
                  </div>
                </div>

              {/* Zone Risk Summary */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">Zone Risk Summary</h2>
                  <div className="space-y-3">
                    {(stats?.by_zone || []).slice(0, 5).map((zone: any) => (
                      <div key={zone.zone} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors">
                        <div className="flex items-center gap-2">
                          <Map size={14} className="text-slate-400" />
                          <span className="text-xs font-medium text-slate-700">{zone.zone}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{zone.count}</span>
                          <div className={`w-2 h-2 rounded-full ${zone.count > 10 ? 'bg-rose-500' : zone.count > 5 ? 'bg-orange-500' : 'bg-emerald-500'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Activity Logs Section */}
            {allLogsData.length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-slate-900">Activity Log</h2>
                  <button
                    onClick={() => setActivePage('activity-logs')}
                    className="text-sm text-blue-600 font-medium hover:underline"
                  >
                    View All Activities →
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider">
                        <th className="text-left py-2 px-3 font-bold">Project</th>
                        <th className="text-left py-2 px-3 font-bold">Zone</th>
                        <th className="text-left py-2 px-3 font-bold">Activity</th>
                        <th className="text-left py-2 px-3 font-bold">Start Time</th>
                        <th className="text-left py-2 px-3 font-bold">End Time</th>
                        <th className="text-left py-2 px-3 font-bold">Idle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allLogsData.slice(0, 15).map((log: any, idx: number) => (
                        <tr key={`tbl-${idx}`} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="py-2 px-3 text-slate-700">{log.project || '--'}</td>
                          <td className="py-2 px-3 text-slate-700">{log.zone || '--'}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{formatActivity(log.activity)}</td>
                          <td className="py-2 px-3 text-slate-500">{log.startTime || '--'}</td>
                          <td className="py-2 px-3 text-slate-500">{log.endTime || '--'}</td>
                          <td className="py-2 px-3 text-slate-500">{log.totalIdleTime || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      case 'incidents':
        return <SafetyModelPage isMobile={isMobile} />;
      case 'activity-logs':
        const uniqueLogProjects = Array.from(new Set(allLogsData.map(i => i.project || ''))).filter(Boolean);
        const uniqueLogZones = Array.from(new Set(allLogsData.map(i => i.zone || ''))).filter(Boolean);

        const filteredDisplayLogs = activityLogs.filter(log => {
          const query = searchQuery.toLowerCase();
          return (log.project && log.project.toLowerCase().includes(query)) ||
                 (log.zone && log.zone.toLowerCase().includes(query)) ||
                 (log.activity && log.activity.toLowerCase().includes(query)) ||
                 (log.startTime && log.startTime.toLowerCase().includes(query)) ||
                 (log.endTime && log.endTime.toLowerCase().includes(query)) ||
                  (log.totalIdleTime && log.totalIdleTime.toLowerCase().includes(query));
        });

        const formatIdle = (s: number) => {
          if (s < 60) return `${s}s`;
          if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
          return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
        };

        const calcWorkTime = (start: string, end: string) => {
          if (!start || !end) return '--';
          const s = new Date(start).getTime();
          const e = new Date(end).getTime();
          const diff = Math.floor((e - s) / 1000);
          if (diff < 0) return '--';
          if (diff < 60) return `${diff}s`;
          if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
          return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
        };

        const getWorkTimeHours = (start: string, end: string): number | null => {
          if (!start || !end) return null;
          const s = new Date(start).getTime();
          const e = new Date(end).getTime();
          const diff = (e - s) / 1000;
          if (diff < 0) return null;
          return diff / 3600;
        };

        const getWorkTimeColor = (activity: string | null | undefined, start: string, end: string): string => {
          const ideal = getIdealTime(activity);
          const actual = getWorkTimeHours(start, end);
          if (ideal !== null && actual !== null) {
            if (actual > ideal) return 'text-red-600';
            if (actual < ideal) return 'text-green-600';
          }
          return 'text-slate-900';
        };

        const getWorkTimeTooltipText = (activity: string | null | undefined, start: string, end: string): string | null => {
          const ideal = getIdealTime(activity);
          const actual = getWorkTimeHours(start, end);
          const stdLabel = formatActivity(activity);
          if (ideal === null || actual === null) {
            if (actual !== null) return `Work time: ${calcWorkTime(start, end)} | Std time: N/A`;
            return null;
          }
          const diff = Math.abs(actual - ideal);
          const diffStr = diff >= 1
            ? `${Math.floor(diff)}h ${Math.round((diff % 1) * 60)}m`
            : `${Math.round(diff * 60)}m`;
          if (actual > ideal) return `Std time: ${ideal}h | Work time: ${calcWorkTime(start, end)} | Exceeded by ${diffStr}`;
          if (actual < ideal) return `Std time: ${ideal}h | Work time: ${calcWorkTime(start, end)} | Saved ${diffStr}`;
          return `Std time: ${ideal}h | Work time: ${calcWorkTime(start, end)} | On time`;
        };

        const logsTotalPages = Math.ceil(logsTotalRecords / rowsPerPage);

        const exportToExcel = async () => {
          const data = filteredDisplayLogs.map(log => ({
            Project: log.project || '--',
            Zone: log.zone || '--',
            Activity: formatActivity(log.activity) || '--',
            'Start Time': log.startTime || '--',
            'End Time': log.endTime || '--',
            'Work Time': calcWorkTime(log.startTime, log.endTime),
            'Idle Time': log.totalIdleTime || '--',
            'Ideal Time': (() => { const t = getIdealTime(log.activity); return t === null ? '--' : t >= 24 ? `${t/24} days` : `${t} hrs`; })(),
          }));
          const XLSX = await import('xlsx');
          const ws = XLSX.utils.json_to_sheet(data);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Activity Logs');
          XLSX.writeFile(wb, 'activity_logs.xlsx');
        };

        return (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
                <p className="text-slate-500 text-sm">Historical record of all detected site activities and workflow milestones.</p>
              </div>
              <button onClick={exportToExcel} className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 shadow-sm">
                <Download size={16} /> Export Activity Data
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex flex-col md:flex-row gap-3 flex-wrap items-center">
                {uniqueLogProjects.length > 0 && (
                  <select value={logsSelectedProject} onChange={(e) => setLogsSelectedProject(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none min-w-[140px]">
                    <option value="All">All Projects</option>
                    {uniqueLogProjects.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                <select value={logsSelectedZone} onChange={(e) => setLogsSelectedZone(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none min-w-[140px]">
                  <option value="All">All Zones</option>
                  {uniqueLogZones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 font-medium hidden sm:inline">From:</label>
                  <input type="date" value={logsStartDate} onChange={(e) => setLogsStartDate(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 font-medium hidden sm:inline">To:</label>
                  <input type="date" value={logsEndDate} onChange={(e) => setLogsEndDate(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none"
                  />
                </div>
                {(logsStartDate || logsEndDate) && (
                  <button onClick={() => { setLogsStartDate(''); setLogsEndDate(''); }}
                    className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-200 transition-colors">
                    Clear Dates
                  </button>
                )}
                <div className="flex-1 relative min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <SpeechInput placeholder="Search by project, zone, activity..." value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Activity Logs</h3>
                  <p className="text-sm text-slate-500">Showing {filteredDisplayLogs.length > 0 ? `1-${filteredDisplayLogs.length}` : '0'} of {logsTotalRecords} total records</p>
                </div>
              </div>
              {isMobile ? (
                <div className="divide-y divide-slate-100">
                  {logsLoading ? (
                    <div className="p-4 space-y-3">
                      {[1,2,3,4].map(i => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="skeleton w-10 h-10 rounded-full" />
                          <div className="flex-1 space-y-1.5">
                            <div className="skeleton h-4 w-3/4" />
                            <div className="skeleton h-3 w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredDisplayLogs.length === 0 ? (
                    <div className="py-12 text-center">
                      <Database size={48} className="mx-auto text-slate-300 mb-4" />
                      <h3 className="text-lg font-bold text-slate-900 mb-2">No Data Found</h3>
                      <p className="text-slate-500 text-sm">Try adjusting your filters or date range.</p>
                    </div>
                  ) : (
                    filteredDisplayLogs.map((log, idx) => (
                      <div key={`${log.activity}-${idx}`} className="p-4 space-y-2 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-slate-900">{log.project || '--'}</p>
                          <span className="text-xs text-slate-500">{log.zone || '--'}</span>
                        </div>
                        <p className="text-sm text-slate-700 font-medium">{formatActivity(log.activity) || '--'}</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Start</span>
                            <p className="text-slate-700">{log.startTime || '--'}</p>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">End</span>
                            <p className="text-slate-700">{log.endTime || '--'}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="p-2 rounded-lg bg-slate-50">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Work</span>
                            <p className={cn("font-bold", getWorkTimeColor(log.activity, log.startTime, log.endTime))}>{calcWorkTime(log.startTime, log.endTime)}</p>
                          </div>
                          <div className="p-2 rounded-lg bg-slate-50">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Idle</span>
                            <p className="font-bold text-slate-700">{log.totalIdleTime || '--'}</p>
                          </div>
                          <div className="p-2 rounded-lg bg-slate-50">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Ideal</span>
                            <p className="font-bold text-slate-700">{(() => { const t = getIdealTime(log.activity); if (t === null) return '--'; return t >= 24 ? `${t/24} days` : `${t} hrs`; })()}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Zone</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activity</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Start Time</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">End Time</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Work Time</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Idle Time <span className="font-normal text-slate-400">({formatIdle(logsTotalIdleSeconds)})</span></th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ideal Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logsLoading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center">
                          <Activity className="animate-spin mx-auto text-blue-600" size={32} />
                          <p className="text-sm text-slate-500 mt-2">Loading activity logs...</p>
                        </td>
                      </tr>
                    ) : filteredDisplayLogs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center">
                          <Database size={48} className="mx-auto text-slate-300 mb-4" />
                          <h3 className="text-lg font-bold text-slate-900 mb-2">No Data Found</h3>
                          <p className="text-slate-500 text-sm">Try adjusting your filters or date range.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredDisplayLogs.map((log, idx) => (
                        <tr key={`${log.activity}-${idx}`} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{log.project || '--'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{log.zone || '--'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{formatActivity(log.activity) || '--'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{log.startTime || '--'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{log.endTime || '--'}</td>
                          <td onClick={(e) => {
                            const tip = getWorkTimeTooltipText(log.activity, log.startTime, log.endTime);
                            if (tip) setWorkTimeTooltip({ text: tip, x: e.clientX, y: e.clientY });
                          }} className={`px-4 py-3 text-sm font-medium cursor-pointer ${getWorkTimeColor(log.activity, log.startTime, log.endTime)}`}>{calcWorkTime(log.startTime, log.endTime)}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{log.totalIdleTime || '--'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{(() => { const t = getIdealTime(log.activity); if (t === null) return '--'; return t >= 24 ? `${t/24} days` : `${t} hrs`; })()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              )}
              <div className="p-4 border-t border-slate-100 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Showing {logsTotalRecords > 0 ? `${(currentLogsPage-1)*rowsPerPage+1}–${Math.min(currentLogsPage*rowsPerPage, logsTotalRecords)}` : '0'} of {logsTotalRecords} records
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleLogsPageChange(currentLogsPage-1)} disabled={currentLogsPage===1}
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50">Previous</button>
                  {Array.from({ length: logsTotalPages }, (_,i)=>i+1)
                    .slice(Math.max(0,currentLogsPage-3), Math.min(logsTotalPages, currentLogsPage+2))
                    .map(page => (
                      <button key={page} onClick={() => handleLogsPageChange(page)}
                        className={cn("px-3 py-1.5 text-xs rounded-md",
                          currentLogsPage===page ? "bg-blue-600 text-white" : "border border-slate-200 hover:bg-slate-50")}>
                        {page}
                      </button>
                    ))}
                  <button onClick={() => handleLogsPageChange(currentLogsPage+1)} disabled={currentLogsPage>=logsTotalPages}
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-md disabled:opacity-50 hover:bg-slate-50">Next</button>
                </div>
              </div>
            </div>

            {workTimeTooltip && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWorkTimeTooltip(null)} />
                <div
                  className="fixed z-50 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl pointer-events-none"
                  style={{ left: workTimeTooltip.x + 12, top: workTimeTooltip.y - 10 }}
                >
                  {workTimeTooltip.text}
                </div>
              </>
            )}
          </div>
        );
      case 'audit':
        {
          const siteRole = 'Site Manager';
          const activityOptions = [
            'Asphalt Laying Activity',
            'Auto Launching',
            'Bar Bending Operation',
            'Bar Cutting Operation',
            'Batching Plant Operation',
            'Blasting',
            'Carpentry activity',
            'Casting Yard',
            'Cleaning & grubbing',
            'Concreting',
            'Confined Space',
            'Cranes and Other Lifting Operations',
            'Crusher Operation',
            'Dry Leane concrete',
            'Electrical Works',
            'Embankment Activity',
            'Equipment loading & Unloading',
            'Equipment Maintenance',
            'Erection',
            'Excavation',
            'Finishing Works at Stack Yard',
            'Formwork',
            'Gantry Crane Operation',
            'Gas cutting',
            'Geo technical investigation',
            'Girder Erection',
            'Gluing activity of spine segment',
            'Grinding activity',
            'GSB Laying Activity',
            'Hot Mix Plant Operation',
            'Hot Mix Plant Operation',
            'Material Transporation',
            'Median Maintenance',
            'Median Maintenance activity',
            'Mould Assembling Preparatory Works',
            'Others',
            'Piling',
            'PQC Activity',
            'Prestressing activity',
            'Prime Coat Tack Coat Activity',
            'RE Wall',
            'Rig Marching',
            'Road Marking',
            'Scaffolding',
            'Segment alignment and stitching',
            'Segment Casting',
            'Segment casting, mould assembling and preparatory work',
            'Segment Concreting Work',
            'Segment lifting',
            'Segment Repairing',
            'Segment reparing / finijshing works at stack yard',
            'Segment Stacking and Retriving by Gantry Crane',
            'Segment Transportation',
            'Survey',
            'Welding Activity',
            'Wing segment erection',
            'Wing segment stressing',
            'WMM Laying Activity',
            'WMM Plant Operation',
            'Work at height',
            'Working on Live Road for Road Maintenance Activity',
            'Working on reinforcement',
            'Working on reinforcement zig (Casting yard)',
          ];
          const now = new Date();
          const todayStr = now.toISOString().split('T')[0];
          const safetyIssuesList = uploadResult?.analysis?.safety_issues_list || [];
          const recommendationsList = uploadResult?.analysis?.recommendations_list || [];
          const possibleRisksList = uploadResult?.analysis?.possible_risks_list || [];
          const safetyIssues = safetyIssuesList.length ? safetyIssuesList : (uploadResult?.analysis?.violations || []);
          const recommendations = recommendationsList.length ? recommendationsList : (uploadResult?.analysis?.recommendation ? [uploadResult.analysis.recommendation] : []);
          const possibleIncidents = possibleRisksList;
          const issueRows = (safetyIssues.length ? safetyIssues : uploadResult ? ['Safety issue detected'] : []).map((issue: string, idx: number) => ({
            issue,
            risk: possibleIncidents[idx] || uploadResult?.analysis?.risk || 'Review required',
          }));
          const mobileAuditLayout = (
  <div className="min-h-screen bg-[#F8FAFC] pb-28 page-enter">
    <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
      <div className="flex items-center px-4 h-12">
        <button onClick={() => setActivePage('mobile-home')} className="p-1 -ml-1"><ChevronLeft size={22} className="text-slate-700" /></button>
        <div className="flex-1 text-center">
          <h1 className="text-[17px] font-bold text-slate-900">Safety UAUC</h1>
          <p className="text-[11px] text-slate-500 -mt-0.5">Step 1 of 2</p>
        </div>
        <div className="w-8" />
      </div>
      <div className="px-4 pb-2">
        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full w-1/2 bg-blue-600 rounded-full" />
        </div>
        <div className="flex justify-between mt-1 text-[10px] font-medium text-slate-400 px-0.5">
          <span className="text-blue-600">Capture</span>
          <span>Review</span>
        </div>
      </div>
    </div>
    <div className="flex flex-col animate-fade-in">
      <div className="bg-white px-4 py-2 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800 mb-2">Audit Details</h2>
        <div className="space-y-2.5">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 mb-1 block">Project <span className="text-rose-500">*</span></span>
            <div className="w-full h-[44px] px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 flex items-center">{auditProject}</div>
          </label>
          <SearchableSelect label="Activity" value={auditActivity} setter={setAuditActivity} options={activityOptions} mobile />
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 mb-1 block">Sub Activity <span className="text-rose-500">*</span></span>
            <SpeechInput required value={auditSubActivity} onChange={(e) => setAuditSubActivity(e.target.value)} placeholder="Enter sub activity..."
              className="w-full h-[44px] px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 mb-1 block">Location / Zone <span className="text-rose-500">*</span></span>
            <SpeechInput required value={auditLocation} onChange={(e) => setAuditLocation(e.target.value)} placeholder="Enter location..."
              className="w-full h-[44px] px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 mb-1 block">Initiated By</span>
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">DC</div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{auditInspectorName}</p>
                <p className="text-[11px] text-slate-500">{siteRole}</p>
              </div>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect label="Site Engineer" value={auditSiteEngineer} setter={setAuditSiteEngineer} options={siteEngineerOptions} mobile />
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 mb-1 block">Target Date <span className="text-rose-500">*</span></span>
              <div className="relative">
                <input type="date" required value={auditTargetDate} onChange={(e) => setAuditTargetDate(e.target.value)}
                  min={todayStr} ref={targetDateRef} onClick={() => targetDateRef.current?.showPicker()}
                  className="w-full h-[44px] px-3 pl-10 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </label>
          </div>
        </div>
      </div>
      <div className="bg-white px-4 py-3 border-b border-slate-100">
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5">
          <div className="text-sm font-bold text-blue-700 mb-2.5">Auto Captured Details</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-lg px-3 py-2.5 flex items-center gap-3">
              <Clock size={18} className="text-blue-600 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase leading-tight">Observation Date</p>
                <p className="text-sm font-bold text-slate-800">{now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg px-3 py-2.5 flex items-center gap-3">
              <Clock size={18} className="text-blue-600 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase leading-tight">Observation Time</p>
                <p className="text-sm font-bold text-slate-800">{now.toLocaleTimeString()}</p>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-emerald-700 font-bold text-center flex items-center justify-center gap-1">
            <CheckCircle2 size={13} /> Date & Time captured automatically
          </p>
        </div>
      </div>
      <div className="bg-white px-4 py-2 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-2">
          <Camera size={18} className="text-blue-600" />
          <h2 className="text-sm font-bold text-slate-800">Site Evidence</h2>
        </div>
        {cameraPermissionError && (
          <div className="flex items-start gap-2 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 flex-1">{cameraPermissionError}</p>
            <button type="button" onClick={() => setCameraPermissionError(null)} className="p-0.5"><X size={14} className="text-amber-500" /></button>
          </div>
        )}
        {selectedFile && previewUrl && (
          <div className="rounded-xl overflow-hidden bg-slate-100 mb-2 relative">
            <img src={previewUrl} alt="Preview" loading="lazy" decoding="async" className="w-full h-48 object-cover" />
            <button type="button" onClick={() => setSelectedFile(null)}
              className="absolute top-2 right-2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow"><X size={16} className="text-slate-600" /></button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-2">
<button type="button" onClick={openCamera}
            className="h-[44px] rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
            <Camera size={18} className="text-blue-600" /> Take Photo</button>
          <label className="h-[44px] rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
            <Upload size={18} className="text-blue-600" /> Upload Photo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
          </label>
          <input type="file" accept="image/*" capture="environment" ref={cameraCaptureRef} className="hidden" onChange={handleCameraCapture} />
        </div>
        {selectedFile && previewUrl && (
          <div className="flex items-center gap-3 mb-2">
<button type="button" onClick={openCamera}
              className="flex-1 h-[36px] rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 flex items-center justify-center gap-1"><Camera size={14} /> Retake</button>
            <label className="flex-1 h-[36px] rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 flex items-center justify-center gap-1 cursor-pointer">
              <Upload size={14} /> Replace
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }} />
            </label>
          </div>
        )}
        <p className="text-[11px] text-slate-400">JPG, PNG, HEIC &mdash; Max size 20 MB</p>
      </div>
      <div className="bg-white px-4 py-2 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800 mb-2">Additional Remarks (Optional)</h2>
          <SpeechTextarea value={auditRemarks} onChange={(e) => setAuditRemarks(e.target.value.slice(0, 500))}
            placeholder="Add any observations for the AI analysis..."
            className="w-full h-[80px] resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400" />
        <p className="text-[11px] text-slate-400 text-right mt-0.5">{auditRemarks.length} / 500</p>
      </div>
      {uploadError && <div className="px-4 py-2.5 bg-rose-50 text-xs font-medium text-rose-700">{uploadError}</div>}
    </div>
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
      <form onSubmit={(e) => { e.preventDefault(); setMobileAuditStep('analyzing'); handleFileUpload(e); }}>
        <button type="submit" disabled={!selectedFile || uploadingVideo || !auditProject.trim() || !auditActivity.trim() || !auditSubActivity.trim() || !auditLocation.trim() || !auditTargetDate || !auditSiteEngineer || !auditRemarks.trim()}
          className="w-full h-[48px] rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
          {uploadingVideo ? <Activity size={18} className="animate-spin" /> : <Zap size={18} />}
          {uploadingVideo ? 'Analyzing Media...' : 'Start AI Analysis'}
        </button>
      </form>
    </div>
    {showCamera && (
      <div className="fixed inset-0 z-[200] bg-black flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 bg-black/80">
          <button onClick={() => { setShowCamera(false); if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; }}}
            className="text-white text-sm font-semibold">Cancel</button>
          <span className="text-white text-sm font-medium">Capture Photo</span>
          <div className="w-14" />
        </div>
        <div className="flex-1 relative">
          <video ref={cameraVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <canvas ref={cameraCanvasRef} className="hidden" />
        </div>
        <div className="flex justify-center py-6 bg-black/80">
          <button onClick={() => {
            const video = cameraVideoRef.current;
            const canvas = cameraCanvasRef.current;
            if (!video || !canvas) return;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
              if (blob) { const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' }); setSelectedFile(file); }
              cameraStreamRef.current?.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; setShowCamera(false);
            }, 'image/jpeg', 0.9);
          }}
            className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center hover:opacity-80 transition-opacity">
            <div className="w-12 h-12 rounded-full bg-white" />
          </button>
        </div>
      </div>
    )}
  </div>
);

          const progressVal = uploadProgress;
          const steps = [
            { label: 'Image uploaded', key: 0 },
            { label: 'Detecting PPE & hazards', key: 1 },
            { label: 'Mapping risks', key: 2 },
            { label: 'Generating recommendations', key: 3 },
            { label: 'Finalizing report', key: 4 },
          ];
          const currentStep = Math.min(4, Math.floor(progressVal / 20));
          const statusTexts = [
            'Uploading image for analysis...',
            'Detecting PPE and identifying hazards...',
            'Mapping risks to safety categories...',
            'Generating AI recommendations...',
            'Finalizing your safety report...',
          ];
          const mobileAuditProgressScreen = (
<div className="min-h-screen bg-white flex flex-col page-enter">
              <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
                <div className="flex items-center px-4 h-12">
                  <button onClick={handleBackFromAnalysis} className="p-1 -ml-1"><ChevronLeft size={22} className="text-slate-700" /></button>
                  <div className="flex-1 text-center">
                    <h1 className="text-[17px] font-bold text-slate-900">Analyzing Site Safety</h1>
                  </div>
                  <div className="w-8" />
                </div>
              </div>
              <div className="flex-1 flex flex-col items-center px-6 pt-8 animate-fade-in">
                <p className="text-sm text-slate-500 text-center mt-1 max-w-xs leading-relaxed">
                  Our AI is detecting hazards, identifying compliance issues, and generating recommendations.
                </p>
                <div className="mt-8 mb-6">
                  <img src="/assets/ai-analysis-loader.svg" alt="AI Analysis Progress" decoding="async" className="w-[200px] h-[200px]" />
                </div>
                <div className="text-center mb-6">
                  <div className="text-3xl font-bold text-blue-600">{Math.round(progressVal)}%</div>
                  <div className="text-sm font-medium text-slate-600 mt-1.5">{statusTexts[currentStep]}</div>
                </div>
                <div className="w-full max-w-sm space-y-0">
                  {steps.map((step, idx) => {
                    const isCompleted = idx < currentStep;
                    const isActive = idx === currentStep;
                    return (
                      <div key={step.key} className="flex items-center gap-3 py-2">
                        <div className="flex flex-col items-center">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCompleted ? 'bg-blue-600 text-white' : isActive ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
                            {isCompleted ? (
                              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                                <path d="M4 8l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : isActive ? (
                              <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            ) : (
                              <span className="text-xs">{idx + 1}</span>
                            )}
                          </div>
                          {idx < steps.length - 1 && <div className={`w-0.5 h-5 ${isCompleted ? 'bg-blue-600' : 'bg-slate-200'}`} />}
                        </div>
                        <span className={`text-sm pt-0.5 ${isCompleted || isActive ? 'font-semibold text-slate-800' : 'font-medium text-slate-400'}`}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                {uploadError && (
                  <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs font-medium text-rose-700 max-w-sm w-full">{uploadError}</div>
                )}
                <div className="mt-auto mb-6">
                  <div className="px-4 py-2 bg-slate-100 rounded-full text-xs font-medium text-slate-500 flex items-center gap-1.5 shadow-sm">
                    <Clock size={12} /> Estimated time: 5&ndash;10 seconds
                  </div>
                </div>
              </div>
            </div>
          );

          const selectedCount = selectedIssueIndices.size;
          const totalIssues = issueRows.length;

          const mobileAuditReportScreen = (
            <div className="min-h-screen bg-[#F8FAFC] flex flex-col page-enter">
              <div className="sticky top-0 z-20 bg-white border-b border-slate-200">
                <div className="flex items-center px-4 h-12">
                  <button onClick={() => { setMobileAuditStep('form'); }} className="p-1 -ml-1"><ChevronLeft size={22} className="text-slate-700" /></button>
                  <div className="flex-1 text-center">
                    <h1 className="text-[17px] font-bold text-slate-900">AI Analysis Report</h1>
                    <p className="text-[11px] text-slate-500 -mt-0.5">ID: {auditDisplayId || 'Processing...'}</p>
                  </div>
                  <button onClick={() => {
                    if (!editingReport) {
                      setEditedIssues(issueRows.map((r: any) => ({ ...r })));
                      setEditedRecs([...recommendations]);
                    }
                    setEditingReport(!editingReport);
                  }} className="p-2 rounded-lg text-slate-500 hover:text-blue-600 transition-colors" title={editingReport ? 'Done Editing' : 'Edit Report'}>
                    {editingReport ? <Check size={18} /> : <Edit3 size={18} />}
                  </button>
                  <button onClick={handleExportAuditPDF} className="p-2 rounded-lg text-slate-500 hover:text-blue-600 transition-colors" title="Download PDF Report">
                    <Download size={18} />
                  </button>
                </div>
                <div className="px-4 pb-2">
                  <div className="flex items-center justify-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold">Completed</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 pb-28">
                <div className="grid grid-cols-2 gap-2 px-4 pt-3 pb-1.5">
                  <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                    <p className="text-xl font-bold text-rose-600">{issueRows.length}</p>
                    <p className="text-[11px] font-semibold text-slate-700">Safety Issues</p>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-xl font-bold text-emerald-600">{recommendations.length}</p>
                    <p className="text-[11px] font-semibold text-slate-700">Recommendations</p>
                  </div>
                </div>
                <div className="bg-white px-4 py-2 border-b border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <h2 className="text-sm font-bold text-slate-800">Detected Safety Issues</h2>
                    {issueRows.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => {
                          if (selectedIssueIndices.size === issueRows.length) {
                            setSelectedIssueIndices(new Set());
                          } else {
                            setSelectedIssueIndices(new Set(Array.from({ length: issueRows.length }, (_, i) => i)));
                          }
                        }} className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                          {selectedIssueIndices.size === issueRows.length ? 'Deselect All' : 'Select All'}
                        </button>
                        <span className="text-[10px] font-bold text-slate-400">{selectedCount} of {totalIssues} Selected</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    {editingReport ? (
                      editedIssues.map((row: any, idx: number) => (
                        <div key={idx} className="p-2.5 rounded-lg border border-blue-200 bg-blue-50">
                          <SpeechInput value={row.issue} onChange={(e) => { const next = [...editedIssues]; next[idx] = { ...next[idx], issue: e.target.value }; setEditedIssues(next); }} className="w-full text-xs font-semibold bg-white border border-slate-200 rounded px-2 py-1 mb-1" />
                          <SpeechInput value={row.risk} onChange={(e) => { const next = [...editedIssues]; next[idx] = { ...next[idx], risk: e.target.value }; setEditedIssues(next); }} className="w-full text-[10px] bg-white border border-slate-200 rounded px-2 py-1 text-slate-500" />
                        </div>
                      ))
                    ) : (
                      issueRows.map((row: any, idx: number) => (
                      <label key={idx} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${selectedIssueIndices.has(idx) ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-white'}`}>
                        <input type="checkbox" checked={selectedIssueIndices.has(idx)}
                          onChange={() => { const next = new Set(selectedIssueIndices); next.has(idx) ? next.delete(idx) : next.add(idx); setSelectedIssueIndices(next); }}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold ${selectedIssueIndices.has(idx) ? 'text-slate-800' : 'text-slate-400'}`}>{row.issue}</p>
                          <p className={`text-[10px] mt-0.5 ${selectedIssueIndices.has(idx) ? 'text-slate-500' : 'text-slate-300'}`}>Risk: {row.risk}</p>
                        </div>
                      </label>
                    )))}
                  </div>
                </div>
                <div className="bg-white px-4 py-2 border-b border-slate-100">
                  <h2 className="text-sm font-bold text-slate-800 mb-1.5">AI Recommendations</h2>
                  <div className="space-y-1.5">
                    {editingReport ? (
                      editedRecs.map((rec: string, idx: number) => (
                        <div key={idx} className="flex gap-1.5 items-start">
                          <CheckCircle2 size={14} className="text-emerald-500 mt-1 shrink-0" />
                          <SpeechInput value={rec} onChange={(e) => { const next = [...editedRecs]; next[idx] = e.target.value; setEditedRecs(next); }} className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1 text-slate-600" />
                        </div>
                      ))
                    ) : (
                      (recommendations.length ? recommendations : ['Review the uploaded frame and follow site safety procedures.']).map((rec: string, idx: number) => (
                      <p key={idx} className="text-xs text-slate-600 flex gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                        {rec}
                      </p>
                    )))}
                  </div>
                </div>
                {uploadResult && <div className="bg-white px-4 py-2">
                  <h2 className="text-sm font-bold text-slate-800 mb-1.5">Analyzed Image (AI Annotations)</h2>
                  <div className="rounded-xl bg-slate-900 overflow-hidden max-h-[300px]">
                    {uploadResult.mediaType === 'video' ? <video src={uploadResult.mediaUrl} controls className="w-full h-full object-contain" /> : <img src={uploadResult.annotatedMediaUrl || uploadResult.mediaUrl} alt="Analyzed" loading="lazy" decoding="async" className="w-full h-full object-contain" referrerPolicy="no-referrer" />}
                  </div>
                </div>}
              </div>
              <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 shadow-lg">
                <div className="flex gap-2.5">
                  <button onClick={handleCancelReport} className="flex-1 h-[44px] rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors">Cancel</button>
                  <button onClick={handleSaveAudit} disabled={savingAudit}
                    className={`flex-1 h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ${savingAudit ? 'bg-slate-400 text-slate-200 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    {savingAudit ? <><Activity size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save UAUC</>}</button>
                </div>
              </div>
              {uaucSavedToast && (
                <div className="fixed bottom-20 inset-x-4 z-50 animate-fade-in">
                  <div className="bg-emerald-600 text-white text-sm font-bold px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
                        <path d="M4 8l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    UAUC saved successfully
                  </div>
                </div>
              )}
            </div>
          );

          return isMobile ? (mobileAuditStep === 'analyzing' ? mobileAuditProgressScreen : mobileAuditStep === 'report' ? mobileAuditReportScreen : mobileAuditLayout) : (
            <div className={cn("space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500", isMobile && "pb-20")}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-blue-700 mb-2">UAUC Capture <ChevronRight size={14} className="inline mx-1" /> Safety UAUC</div>
                  <h2 className="text-2xl font-bold text-slate-900">UAUC Capture</h2>
                  <p className="text-slate-500">Upload site photos or footage for deep AI safety inspection</p>
                </div>
                {!isMobile && (
                  <div className="flex gap-2">
                    <button onClick={() => { setUploadResult(null); setSelectedFile(null); setAuditDisplayId(''); setSelectedIssueIndices(new Set()); }} className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                    <button onClick={handleSaveAudit} disabled={savingAudit || !uploadResult} className={`px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 ${(savingAudit || !uploadResult) ? 'bg-slate-400 text-slate-200 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>{savingAudit ? <><Activity size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save UAUC</>}</button>
                  </div>
                )}
              </div>
              {isMobile && (
                <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-3 shadow-lg">
                  <button onClick={() => { setUploadResult(null); setSelectedFile(null); setAuditDisplayId(''); setSelectedIssueIndices(new Set()); }} className="flex-1 py-3 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button onClick={handleSaveAudit} disabled={savingAudit || !uploadResult} className={`flex-1 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 ${(savingAudit || !uploadResult) ? 'bg-slate-400 text-slate-200 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>{savingAudit ? <><Activity size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save UAUC</>}</button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <form onSubmit={handleFileUpload} className="space-y-4">
                    <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-3 mb-4"><span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">1</span><h3 className="font-bold text-slate-900">Audit Information</h3></div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="space-y-1.5">
                          <span className="text-xs font-bold text-slate-700">Project <span className="text-rose-500">*</span></span>
                          <div className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 flex items-center">{auditProject}</div>
                        </label>
                        <SearchableSelect label="Activity" value={auditActivity} setter={setAuditActivity} options={activityOptions} />
                        <label className="space-y-1.5">
                          <span className="text-xs font-bold text-slate-700">Sub Activity <span className="text-rose-500">*</span></span>
                           <SpeechInput required value={auditSubActivity} onChange={(e) => setAuditSubActivity(e.target.value)} placeholder="Enter sub activity..."
                             className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                         </label>
                         <label className="space-y-1.5">
                           <span className="text-xs font-bold text-slate-700">Location / Zone <span className="text-rose-500">*</span></span>
                           <SpeechInput required value={auditLocation} onChange={(e) => setAuditLocation(e.target.value)} placeholder="Enter location..."
                             className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                         </label>
                      </div>
                      <label className="block mt-4 space-y-1.5">
                        <span className="text-xs font-bold text-slate-700">Initiated By</span>
                        <div className="h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-sm font-semibold text-slate-600">
                          <span>{auditInspectorName}</span><Users size={16} />
                        </div>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <label className="space-y-1.5">
                          <span className="text-xs font-bold text-slate-700">Target Date <span className="text-rose-500">*</span></span>
                          <input type="date" required value={auditTargetDate} onChange={(e) => setAuditTargetDate(e.target.value)}
                            min={todayStr} ref={targetDateRef} onClick={() => targetDateRef.current?.showPicker()}
                            className="w-full h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                        </label>
                        <SearchableSelect label="Site Engineer" value={auditSiteEngineer} setter={setAuditSiteEngineer} options={siteEngineerOptions} />
                      </div>
                      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                        <div className="text-sm font-bold text-blue-700 mb-3">Auto Captured Details</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white rounded-lg p-3 flex items-center gap-3"><Clock size={20} className="text-blue-600" /><div><p className="text-[10px] text-slate-400 font-bold uppercase">Observation Date</p><p className="text-sm font-bold">{now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p></div></div>
                          <div className="bg-white rounded-lg p-3 flex items-center gap-3"><Clock size={20} className="text-blue-600" /><div><p className="text-[10px] text-slate-400 font-bold uppercase">Observation Time</p><p className="text-sm font-bold">{now.toLocaleTimeString()}</p></div></div>
                        </div>
                        <p className="mt-3 text-xs text-emerald-700 font-bold text-center flex items-center justify-center gap-1"><CheckCircle2 size={14} /> Date & Time captured automatically</p>
                      </div>
                    </section>

                    <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-3 mb-4"><span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">2</span><h3 className="font-bold text-slate-900">Upload Media</h3></div>
                      <p className="text-slate-500 text-sm mb-4">Choose a photo from your device or take a picture using your camera.</p>
                      <div className="space-y-3">
                        {cameraPermissionError && (
                          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-xs text-amber-800 flex-1">{cameraPermissionError}</p>
                            <button type="button" onClick={() => setCameraPermissionError(null)} className="p-0.5"><X size={14} className="text-amber-500" /></button>
                          </div>
                        )}
                        {selectedFile && previewUrl && (
                          <div className="aspect-video rounded-xl bg-slate-900 overflow-hidden relative">
                            <img src={previewUrl} alt="Preview" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            <button type="button" onClick={() => setSelectedFile(null)} className="absolute top-2 right-2 bg-white text-slate-600 p-1 rounded-full"><X size={14} /></button>
                          </div>
                        )}
                        <input id="media-upload-new" type="file" accept="image/*" required className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                        <label htmlFor="media-upload-new" className="flex items-center justify-between w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                          <span className="text-sm text-slate-600 truncate">{selectedFile ? selectedFile.name : 'Upload photo from device...'}</span>
                          <ImageIcon size={18} className="text-slate-400" />
                        </label>
                        <input type="file" accept="image/*" capture="environment" ref={cameraCaptureRef} className="hidden" onChange={handleCameraCapture} />
<button type="button" onClick={openCamera} className="flex items-center justify-between w-full px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl cursor-pointer hover:bg-blue-100 transition-colors">
              <span className="text-sm text-blue-700 font-medium">Take a picture</span>
              <Camera size={18} className="text-blue-500" />
            </button>
                      </div>
                      <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50/50 p-3">
                        <label className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2"><Edit3 size={16} className="text-orange-500" /> Brief Description <span className="text-rose-500">*</span></label>
                        <SpeechTextarea required value={auditRemarks} onChange={(e) => setAuditRemarks(e.target.value.slice(0, 500))} placeholder="Add your remarks about this observation..."
                          className="w-full h-20 resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                        <p className="text-[10px] text-slate-400 text-right">{auditRemarks.length} / 500</p>
                      </div>
                      {uploadingVideo && (
                        <div className="mt-4 space-y-1.5">
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out" style={{ width: `${uploadProgress}%` }} />
                          </div>
                          <p className="text-[10px] text-slate-400 text-right font-medium">{Math.round(uploadProgress)}%</p>
                        </div>
                      )}
                      <button type="submit" disabled={!selectedFile || uploadingVideo || !auditProject.trim() || !auditActivity.trim() || !auditSubActivity.trim() || !auditLocation.trim() || !auditTargetDate || !auditSiteEngineer || !auditRemarks.trim()} className="mt-4 w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                        {uploadingVideo ? <Activity className="animate-spin" size={18} /> : <Zap size={18} />} {uploadingVideo ? 'Analyzing Media...' : 'Start AI Analysis'}
                      </button>
                      {uploadError && <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs font-medium text-rose-700">{uploadError}</div>}
                    </section>
                  </form>

                  {showCamera && (
                    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl">
                        <div className="relative bg-black">
                          <video ref={cameraVideoRef} autoPlay playsInline className="w-full aspect-[4/3] object-cover" />
                          <canvas ref={cameraCanvasRef} className="hidden" />
                        </div>
                        <div className="flex items-center justify-center gap-4 p-4">
                          <button type="button" onClick={() => { setShowCamera(false); cameraStreamRef.current?.getTracks().forEach(t => t.stop()); cameraStreamRef.current = null; }} className="px-5 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200">
                            Cancel
                          </button>
                          <button type="button" onClick={() => {
                            const video = cameraVideoRef.current;
                            const canvas = cameraCanvasRef.current;
                            if (!video || !canvas) return;
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) return;
                            ctx.drawImage(video, 0, 0);
                            canvas.toBlob((blob) => {
                              if (blob) {
                                const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
                                setSelectedFile(file);
                              }
                              cameraStreamRef.current?.getTracks().forEach(t => t.stop());
                              cameraStreamRef.current = null;
                              setShowCamera(false);
                            }, 'image/jpeg', 0.9);
                          }} className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 flex items-center gap-2">
                            <Camera size={16} /> Capture
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm min-h-[720px]">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">3</span><h3 className="font-bold text-slate-900">AI Analysis Results</h3>{uploadResult && <span className="px-3 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-bold">Completed</span>}</div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-500">Audit ID: {auditDisplayId || 'Pending'}</span>
                        {uploadResult && <button onClick={handleExportAuditPDF} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors" title="Download PDF Report"><Download size={14} /></button>}
                      </div>
                    </div>
                    {!uploadResult ? (
                      <div className="h-[620px] rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-center">
                        <div><Activity size={42} className="mx-auto mb-4 text-slate-300" /><p className="text-sm font-semibold text-slate-400">Upload media and start analysis to see results here.</p></div>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="rounded-xl border border-rose-100 bg-rose-50 p-5"><p className="text-3xl font-bold text-rose-600">{issueRows.length}</p><p className="text-sm font-bold text-slate-700">Safety Issues Found</p></div>
                          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5"><p className="text-3xl font-bold text-emerald-600">{recommendations.length}</p><p className="text-sm font-bold text-slate-700">Recommendations</p></div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-slate-900">Detected Safety Issues</h4>
                            {issueRows.length > 0 && (
                              <button onClick={() => {
                                if (selectedIssueIndices.size === issueRows.length) {
                                  setSelectedIssueIndices(new Set());
                                } else {
                                  setSelectedIssueIndices(new Set(Array.from({ length: issueRows.length }, (_, i) => i)));
                                }
                              }} className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-wider">
                                {selectedIssueIndices.size === issueRows.length ? 'Deselect All' : 'Select All'}
                              </button>
                            )}
                          </div>
                          <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="w-12 text-center px-2 py-3"><input type="checkbox" checked={issueRows.length > 0 && selectedIssueIndices.size === issueRows.length} onChange={() => {
                                if (selectedIssueIndices.size === issueRows.length) {
                                  setSelectedIssueIndices(new Set());
                                } else {
                                  setSelectedIssueIndices(new Set(Array.from({ length: issueRows.length }, (_, i) => i)));
                                }
                              }} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></th><th className="text-left px-4 py-3">Safety Issue</th><th className="text-left px-4 py-3">Potential Risk</th></tr></thead>
                              <tbody>{issueRows.map((row: any, idx: number) => <tr key={idx} className={`border-t border-slate-100 ${!selectedIssueIndices.has(idx) ? 'opacity-50' : ''}`}><td className="w-12 text-center px-2 py-3"><input type="checkbox" checked={selectedIssueIndices.has(idx)} onChange={() => { const next = new Set(selectedIssueIndices); if (next.has(idx)) next.delete(idx); else next.add(idx); setSelectedIssueIndices(next); }} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td><td className={`px-4 py-3 font-semibold ${selectedIssueIndices.has(idx) ? 'text-slate-700' : 'text-slate-400'}`}><span className="text-rose-500 mr-2">•</span>{row.issue}</td><td className={`px-4 py-3 ${selectedIssueIndices.has(idx) ? 'text-slate-600' : 'text-slate-400'}`}>{row.risk}</td></tr>)}</tbody>
                            </table>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-4">
                          <h4 className="font-bold text-slate-900 mb-3">AI Recommendations</h4>
                          <div className="space-y-2">{(recommendations.length ? recommendations : ['Review the uploaded frame and follow site safety procedures.']).map((rec: string, idx: number) => <p key={idx} className="text-sm text-slate-700 flex gap-2"><CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />{rec}</p>)}</div>
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 mb-2">Analyzed Image (AI Annotations)</h4>
                          <div className="rounded-xl bg-slate-900 overflow-hidden max-h-[500px]">
                            {uploadResult.mediaType === 'video' ? <video src={uploadResult.mediaUrl} controls className="w-full h-full object-contain" /> : <img src={uploadResult.annotatedMediaUrl || uploadResult.mediaUrl} alt="Analyzed" loading="lazy" decoding="async" className="w-full h-full object-contain" referrerPolicy="no-referrer" />}
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
              </div>
            </div>
          );
        }
      case 'activity-analytics': {
        const logs = allLogsData || [];
        const secToHrs = (s: number) => Math.round((s / 3600) * 100) / 100;

        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const filteredLogs = logs.filter(log => {
          if (analyticsFilter1 !== 'All' && log.project !== analyticsFilter1) return false;
          if (analyticsFilter2 !== 'All' && log.zone !== analyticsFilter2) return false;
          if (analyticsFilter3 !== 'All' && log.activity !== analyticsFilter3) return false;
          if (analyticsFilter4 !== 'All' && log.zone !== analyticsFilter4) return false;
          if (analyticsFilter5 !== 'All Time' && log.startTime) {
            const d = new Date(log.startTime);
            if (analyticsFilter5 === 'This Month') {
              if (d.getMonth() + 1 !== currentMonth || d.getFullYear() !== currentYear) return false;
            } else if (analyticsFilter5 === 'Last Month') {
              const lm = currentMonth === 1 ? 12 : currentMonth - 1;
              const ly = currentMonth === 1 ? currentYear - 1 : currentYear;
              if (d.getMonth() + 1 !== lm || d.getFullYear() !== ly) return false;
            } else if (analyticsFilter5 === 'Last 3 Months') {
              const threeMonthsAgo = new Date(now);
              threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
              if (d < threeMonthsAgo) return false;
            }
          }
          return true;
        });

        const actMap: Record<string, { name: string; totalIdle: number; totalWork: number; count: number }> = {};
        const zoneMap: Record<string, { totalIdle: number; totalWork: number; count: number }> = {};
        const subProcMap: Record<string, Record<string, { totalIdle: number; count: number }>> = {};
        const monthlyMap: Record<number, number> = {};

        for (const log of filteredLogs) {
          const name = log.activity || 'Unknown';
          const zone = log.zone || 'Unknown';
          const idleHrs = secToHrs(log.totalIdleSeconds || 0);
          const workHrs = secToHrs(log.totalWorkSeconds || 0);

          if (!actMap[name]) actMap[name] = { name, totalIdle: 0, totalWork: 0, count: 0 };
          actMap[name].totalIdle += idleHrs;
          actMap[name].totalWork += workHrs;
          actMap[name].count++;

          if (!zoneMap[zone]) zoneMap[zone] = { totalIdle: 0, totalWork: 0, count: 0 };
          zoneMap[zone].totalIdle += idleHrs;
          zoneMap[zone].totalWork += workHrs;
          zoneMap[zone].count++;

          if (!subProcMap[name]) subProcMap[name] = {};
          if (!subProcMap[name][zone]) subProcMap[name][zone] = { totalIdle: 0, count: 0 };
          subProcMap[name][zone].totalIdle += idleHrs;
          subProcMap[name][zone].count++;

          if (log.startTime) {
            const month = parseInt(log.startTime.split('-')[1]);
            if (month >= 1 && month <= 12) monthlyMap[month] = (monthlyMap[month] || 0) + 1;
          }
        }

        const actPerf = Object.values(actMap)
          .map(a => ({ name: a.name, avgIdle: a.count > 0 ? Math.round((a.totalIdle / a.count) * 100) / 100 : 0, avgWT: a.count > 0 ? Math.round((a.totalWork / a.count) * 100) / 100 : 0 }))
          .sort((a, b) => b.avgIdle - a.avgIdle);

        const workVsIdle = Object.values(actMap)
          .map(a => ({ name: a.name, workHours: Math.round(a.totalWork * 100) / 100, idleHours: Math.round(a.totalIdle * 100) / 100 }))
          .sort((a, b) => b.workHours - a.workHours);

        const zoneEff = Object.entries(zoneMap)
          .map(([zone, d]) => ({ mould: zone, avgIdle: d.count > 0 ? Math.round((d.totalIdle / d.count) * 100) / 100 : 0, avgWT: d.count > 0 ? Math.round((d.totalWork / d.count) * 100) / 100 : 0 }))
          .sort((a, b) => b.avgIdle - a.avgIdle);

        const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: monthlyMap[i + 1] || 0 }));

        const subProc: Record<string, { mould: string; time: number }[]> = {};
        for (const [act, zones] of Object.entries(subProcMap)) {
          subProc[act] = Object.entries(zones).map(([zone, d]) => ({
            mould: zone,
            time: d.count > 0 ? Math.round((d.totalIdle / d.count) * 100) / 100 : 0,
          }));
        }

        // Ideal vs Actual by Activity
        const activityIdealVsActual = Object.values(actMap)
          .map(a => {
            const ideal = getIdealTime(a.name);
            if (ideal === null) return null;
            const avgWork = a.count > 0 ? Math.round((a.totalWork / a.count) * 100) / 100 : 0;
            return { name: a.name, idealTime: ideal, actualTime: avgWork };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => b.actualTime - a.actualTime);

        // Ideal vs Actual by Zone
        const zoneIdealTimes: Record<string, { totalIdeal: number; count: number }> = {};
        for (const log of filteredLogs) {
          const zone = log.zone || 'Unknown';
          const ideal = getIdealTime(log.activity);
          if (ideal !== null) {
            if (!zoneIdealTimes[zone]) zoneIdealTimes[zone] = { totalIdeal: 0, count: 0 };
            zoneIdealTimes[zone].totalIdeal += ideal;
            zoneIdealTimes[zone].count++;
          }
        }
        const zoneIdealVsActual = Object.entries(zoneMap)
          .map(([zone, d]) => {
            const avgWork = d.count > 0 ? Math.round((d.totalWork / d.count) * 100) / 100 : 0;
            const zi = zoneIdealTimes[zone];
            const avgIdeal = zi && zi.count > 0 ? Math.round((zi.totalIdeal / zi.count) * 100) / 100 : 0;
            if (avgIdeal === 0 && avgWork === 0) return null;
            return { name: zone, idealTime: avgIdeal, actualTime: avgWork };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => b.actualTime - a.actualTime);

        const totalActivities = filteredLogs.length;
        const totalIdleHours = filteredLogs.reduce((s, l) => s + secToHrs(l.totalIdleSeconds || 0), 0);
        const totalWorkHours = filteredLogs.reduce((s, l) => s + secToHrs(l.totalWorkSeconds || 0), 0);
        const avgIdleHours = totalActivities > 0 ? Math.round((totalIdleHours / totalActivities) * 100) / 100 : 0;
        const uniqueActivities = actPerf.length;

        const formatDuration = (h: number) => {
          if (h < 0.01) return '0 mins';
          if (h < 1) return `${Math.round(h * 60)} mins`;
          return `${h.toFixed(1)} hrs`;
        };

        const filterProjects = [...new Set(allLogsData.map(l => l.project).filter(Boolean))];
        const filterZones = [...new Set(allLogsData.map(l => l.zone).filter(Boolean))];
        const filterActivities = [...new Set(allLogsData.map(l => l.activity).filter(Boolean))];

        return (
          <div className="space-y-4 bg-gray-100 min-h-screen p-6">
            {/* TOP ACTION BANNER */}
            <div className="bg-[#0B3C5D] rounded-xl px-6 py-4 flex items-center justify-between shadow-sm">
              <h1 className="text-2xl font-bold text-white tracking-wider">SGMT CASTING TRACKER</h1>
              <div className="flex items-center gap-3">
                <select value={analyticsFilter1} onChange={e => setAnalyticsFilter1(e.target.value)} className="text-xs px-3 py-1.5 rounded border border-white/20 bg-white/10 text-white">
                  <option value="All" style={{ color: '#111', background: '#fff' }}>All Projects</option>
                  {filterProjects.map(p => <option key={p} value={p} style={{ color: '#111', background: '#fff' }}>{p}</option>)}
                </select>
                <select value={analyticsFilter2} onChange={e => setAnalyticsFilter2(e.target.value)} className="text-xs px-3 py-1.5 rounded border border-white/20 bg-white/10 text-white">
                  <option value="All" style={{ color: '#111', background: '#fff' }}>All Zones</option>
                  {filterZones.map(z => <option key={z} value={z} style={{ color: '#111', background: '#fff' }}>{z}</option>)}
                </select>
                <select value={analyticsFilter3} onChange={e => setAnalyticsFilter3(e.target.value)} className="text-xs px-3 py-1.5 rounded border border-white/20 bg-white/10 text-white">
                  <option value="All" style={{ color: '#111', background: '#fff' }}>All Activities</option>
                  {filterActivities.map(a => <option key={a} value={a} style={{ color: '#111', background: '#fff' }}>{a}</option>)}
                </select>
                <select value={analyticsFilter4} onChange={e => setAnalyticsFilter4(e.target.value)} className="text-xs px-3 py-1.5 rounded border border-white/20 bg-white/10 text-white">
                  <option value="All" style={{ color: '#111', background: '#fff' }}>All Moulds</option>
                  {filterZones.map(z => <option key={z} value={z} style={{ color: '#111', background: '#fff' }}>{z}</option>)}
                </select>
                <select value={analyticsFilter5} onChange={e => setAnalyticsFilter5(e.target.value)} className="text-xs px-3 py-1.5 rounded border border-white/20 bg-white/10 text-white">
                  <option value="This Month" style={{ color: '#111', background: '#fff' }}>This Month</option>
                  <option value="Last Month" style={{ color: '#111', background: '#fff' }}>Last Month</option>
                  <option value="Last 3 Months" style={{ color: '#111', background: '#fff' }}>Last 3 Months</option>
                  <option value="All Time" style={{ color: '#111', background: '#fff' }}>All Time</option>
                </select>
              </div>
            </div>

            {/* TOP ROW — Full-width Vertical Grouped Column Chart */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Average Actual Time activity wise</h3>
              <div className="h-[380px]">
                <Suspense fallback={<div className="skeleton w-full h-full" />}>
                  <DurationBarChart data={workVsIdle} xKey="name"
                    bars={[{dataKey:'idleHours', name:'Avg Idle Time', fill:'#D9534F'}, {dataKey:'workHours', name:'Avg Working Time', fill:'#0275D8'}]} />
                </Suspense>
              </div>
            </div>

            {/* MIDDLE ROW — 2-column grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Number of Segment Casting</h3>
                <div className="h-[260px]">
                  <Suspense fallback={<div className="skeleton w-full h-full" />}>
                    <MonthlyBarChart data={monthly} xKey="month" />
                  </Suspense>
                </div>
              </div>
              <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Avg Idle Time and Avg WT by Mould No</h3>
                <div className="h-[260px]">
                  <Suspense fallback={<div className="skeleton w-full h-full" />}>
                    <DurationBarChart data={zoneEff} xKey="mould" xTickSize={8}
                      bars={[{dataKey:'avgIdle', name:'Avg Idle', fill:'#D9534F'}, {dataKey:'avgWT', name:'Avg WT', fill:'#0275D8'}]} />
                  </Suspense>
                </div>
              </div>
            </div>

            {/* DASHBOARD: Ideal Time vs Working Time */}
            <div>
              <h2 className="text-base font-bold text-slate-900 mb-3">Ideal Time vs Working Time Dashboard</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-4">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">Ideal Time vs Working Time by Activity</h3>
                  <div className="h-[300px]">
                    <Suspense fallback={<div className="skeleton w-full h-full" />}>
                      <DurationBarChart data={activityIdealVsActual} xKey="name"
                        bars={[{dataKey:'idealTime', name:'Ideal Time', fill:'#10B981'}, {dataKey:'actualTime', name:'Actual Working Time', fill:'#0275D8'}]} />
                    </Suspense>
                  </div>
                </div>
                <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-4">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">Ideal Time vs Working Time by Zone</h3>
                  <div className="h-[300px]">
                    <Suspense fallback={<div className="skeleton w-full h-full" />}>
                      <DurationBarChart data={zoneIdealVsActual} xKey="name" xTickSize={10}
                        bars={[{dataKey:'idealTime', name:'Ideal Time', fill:'#10B981'}, {dataKey:'actualTime', name:'Actual Working Time', fill:'#0275D8'}]} />
                    </Suspense>
                  </div>
                </div>
              </div>
            </div>

          </div>
        );
      }
      case 'settings':
        return (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">System Configuration</h1>
              <p className="text-slate-500 text-sm">Manage AI detection sensitivity and site zone definitions.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-blue-600" /> Safety Detection
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">PPE Compliance Sensitivity</span>
                    <input type="range" className="w-24" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">Hazard Zone Alerts</span>
                    <div className="w-8 h-4 bg-blue-600 rounded-full relative"><div className="absolute right-1 top-1 w-2 h-2 bg-white rounded-full" /></div>
                  </div>
                </div>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Activity size={18} className="text-blue-600" /> Operational Insights
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">Activity Detection Interval</span>
                    <span className="text-xs font-bold text-slate-900">5 mins</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">Auto-generate Reports</span>
                    <div className="w-8 h-4 bg-slate-200 rounded-full relative"><div className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full" /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
         );
      case 'mobile-workspace-loader':
        if (!user) return null;
        return <MobileWorkspaceLoader user={user} onComplete={() => setActivePage(user.role === 'sbg' || user.sbg?.trim().toLowerCase() === 'y' ? 'project-dashboard' : 'mobile-home')} />;
      case 'mobile-home':
        if (!user) return null;
        const mDefaultTab = mobileHomeDefaultTabRef.current;
        const mDefaultStatusFilter = mobileHomeDefaultStatusFilterRef.current;
        mobileHomeDefaultTabRef.current = '';
        mobileHomeDefaultStatusFilterRef.current = '';
        return <MobileHomePage user={user} submissions={closureSubmissions} setActivePage={setActivePage} onLogout={handleLogout} onViewDetail={handleSiteViewDetail} onEhsReview={handleReviewSubmission} defaultTab={mDefaultTab} defaultStatusFilter={mDefaultStatusFilter} />;
      case 'my-tasks-init':
        const mySubmissionsEhs = user?.name && user?.role !== 'super_admin' ? closureSubmissions.filter(s => s.initiatedBy === user.name) : closureSubmissions;
        return <MyTasksInitPage submissions={mySubmissionsEhs} initiatorName={auditInspectorName}
          onReviewSubmission={handleReviewSubmission}
          onViewDetail={handleEhsViewDetail} userRole={user?.role || ''} />;
      case 'uauc-approval':
        return isMobile ? (
          <MobileUAUCApprovalPage item={selectedApprovalItem} numericId={selectedApprovalItem?.id || null} onBack={handleBackToMyTasks}
            onDecision={handleDecision} onDecisionComplete={handleApprovalComplete} />
        ) : (
          <UAUCApprovalPage item={selectedApprovalItem} numericId={selectedApprovalItem?.id || null} onBack={handleBackToMyTasks}
            onDecision={handleDecision} onDecisionComplete={handleApprovalComplete} />
        );
      case 'demo':
        const demoSub = closureSubmissions.find(s => s.id === selectedUaucId);
        return (
          <DemoPage
            uaucId={selectedUaucId}
            defaultStatus={demoSub?.status}
            onBack={handleBackToMyUaucs}
            onClosureSubmitted={handleClosureSubmitted}
          />
        );
      case 'uauc-closure':
        const mobSub = closureSubmissions.find(s => s.id === selectedUaucId);
        return (
          <MobileUAUCClosureWizard
            uaucId={selectedUaucId}
            defaultStatus={mobSub?.status}
            onBack={handleBackToMyUaucs}
            onClosureSubmitted={handleClosureSubmitted}
          />
        );
      case 'my-uaucs':
        const mySubsSite = user?.name && user?.role !== 'super_admin' ? closureSubmissions.filter(s => s.siteEngineer === user.name) : closureSubmissions;
        return (
          <MyUAUCsPage
            currentEngineer={user?.name || ''}
            submissions={mySubsSite}
            onViewDetail={handleSiteViewDetail}
            isMobile={isMobile}
            userRole={user?.role || ''}
          />
        );
      case 'my-uaucs-detail':
        return (
          <UAUCDetailPage
            uaucId={selectedUaucId}
            onBack={handleBackToMyUaucs}
          />
        );
    }
  };

  // Sidebar Toggle State
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const isFullNav = user?.role === 'super_admin';
  const isEHSRole = user?.role === 'ehs';
  const isSiteRole = user?.role === 'site';
  const isDashRole = user?.role === 'sbg';
  const hasSbgAccess = isDashRole || user?.sbg?.trim().toLowerCase() === 'y';

  const desktopSidebarNav = (
    <nav className="flex-1 px-4 py-2 space-y-1">
      {(isFullNav || isDashRole) && <SidebarItem icon={LayoutDashboard} label="Executive Dashboard" active={activePage === 'executive-dashboard'} onClick={() => { setActivePage('executive-dashboard'); setMobileMenuOpen(false); }} />}
      {hasSbgAccess && <SidebarItem icon={LayoutDashboard} label="SBG Dashboard" active={activePage === 'project-dashboard'} onClick={() => { setActivePage('project-dashboard'); setMobileMenuOpen(false); }} />}
      {(isEHSRole || (hasSbgAccess && !isDashRole)) && <SidebarItem icon={ClipboardCheck} label="Individual Dashboard" active={activePage === 'individual-dashboard'} onClick={() => { setActivePage('individual-dashboard'); setMobileMenuOpen(false); }} />}
      {(isSiteRole || isFullNav) && <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activePage === 'site-dashboard'} onClick={() => { setActivePage('site-dashboard'); setMobileMenuOpen(false); }} />}
      {(isSiteRole || isFullNav) && <SidebarItem icon={FileText} label="Site Engineer" active={activePage === 'my-uaucs' || activePage === 'demo' || activePage === 'uauc-closure'} onClick={() => { setActivePage('my-uaucs'); setMobileMenuOpen(false); }} />}
      {(isEHSRole || isFullNav) && <SidebarItem icon={ClipboardCheck} label="EHS Engineer" active={activePage === 'my-tasks-init' || activePage === 'uauc-approval'} onClick={() => { setActivePage('my-tasks-init'); setMobileMenuOpen(false); }} />}
      {(isEHSRole || isFullNav) && <SidebarItem icon={ClipboardCheck} label="UAUC Capture" active={activePage === 'audit'} onClick={() => { setActivePage('audit'); setMobileMenuOpen(false); }} />}
      {isFullNav && <SidebarItem icon={Video} label="Live Supervision" active={activePage === 'supervision'} onClick={() => { setActivePage('supervision'); setMobileMenuOpen(false); }} />}
      {isFullNav && <div className="pt-4 mt-4 border-t border-slate-100">
        <p className="px-4 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Safety &amp; Compliance</p>
        <SidebarItem icon={AlertTriangle} label="Incidents &amp; Logs" active={activePage === 'incidents'} onClick={() => { setActivePage('incidents'); setMobileMenuOpen(false); }} />
        <SidebarItem icon={ShieldCheck} label="Safety Analytics" active={activePage === 'safety-analytics'} onClick={() => { setActivePage('safety-analytics'); setMobileMenuOpen(false); }} />
      </div>}
      {isFullNav && <div className="pt-4 mt-4 border-t border-slate-100">
        <p className="px-4 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Activity &amp; Operations</p>
        <SidebarItem icon={Activity} label="Activity Logs" active={activePage === 'activity-logs'} onClick={() => { setActivePage('activity-logs'); setMobileMenuOpen(false); }} />
        <SidebarItem icon={BarChart3} label="Operational Insights" active={activePage === 'activity-analytics'} onClick={() => { setActivePage('activity-analytics'); setMobileMenuOpen(false); }} />
      </div>}
      {!isDashRole && <div className="pt-4 mt-4 border-t border-slate-100">
        <SidebarItem icon={Users} label="My Profile" active={activePage === 'profile'} onClick={() => { setActivePage('profile'); setMobileMenuOpen(false); }} />
        {user?.role === 'super_admin' && <SidebarItem icon={ShieldCheck} label="Admin Panel" active={activePage === 'admin'} onClick={() => { setActivePage('admin'); setMobileMenuOpen(false); }} />}
      </div>}
    </nav>
  );

  const sidebarNav = (
    <nav className="flex-1 px-4 py-2 space-y-1">
      {(isFullNav || isDashRole) && <SidebarItem icon={LayoutDashboard} label="Executive Dashboard" active={activePage === 'executive-dashboard'} onClick={() => { setActivePage('executive-dashboard'); setMobileMenuOpen(false); }} />}
      {hasSbgAccess && <SidebarItem icon={LayoutDashboard} label="SBG Dashboard" active={activePage === 'project-dashboard'} onClick={() => { setActivePage('project-dashboard'); setMobileMenuOpen(false); }} />}
      {(isEHSRole || (hasSbgAccess && !isDashRole)) && <SidebarItem icon={ClipboardCheck} label="Individual Dashboard" active={activePage === 'individual-dashboard'} onClick={() => { setActivePage('individual-dashboard'); setMobileMenuOpen(false); }} />}
      {(user?.role === 'site' || user?.role === 'super_admin') && <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activePage === 'site-dashboard'} onClick={() => { setActivePage('site-dashboard'); setMobileMenuOpen(false); }} />}
      {(user?.role === 'site' || user?.role === 'super_admin') && <SidebarItem icon={FileText} label="Site Engineer" active={activePage === 'my-uaucs' || activePage === 'demo' || activePage === 'uauc-closure'} onClick={() => { setActivePage('my-uaucs'); setMobileMenuOpen(false); }} />}
      {(user?.role === 'ehs' || user?.role === 'super_admin') && <SidebarItem icon={ClipboardCheck} label="EHS Engineer" active={activePage === 'my-tasks-init' || activePage === 'uauc-approval'} onClick={() => { setActivePage('my-tasks-init'); setMobileMenuOpen(false); }} />}
      {isFullNav && <SidebarItem icon={Video} label="Live Supervision" active={activePage === 'supervision'} onClick={() => { setActivePage('supervision'); setMobileMenuOpen(false); }} />}
      {isFullNav && <div className="pt-4 mt-4 border-t border-slate-100">
        <p className="px-4 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Safety &amp; Compliance</p>
        <SidebarItem icon={AlertTriangle} label="Incidents &amp; Logs" active={activePage === 'incidents'} onClick={() => { setActivePage('incidents'); setMobileMenuOpen(false); }} />
        <SidebarItem icon={ShieldCheck} label="Safety Analytics" active={activePage === 'safety-analytics'} onClick={() => { setActivePage('safety-analytics'); setMobileMenuOpen(false); }} />
        {(user?.role === 'ehs' || user?.role === 'super_admin') && <SidebarItem icon={ClipboardCheck} label="UAUC Capture" active={activePage === 'audit'} onClick={() => { setActivePage('audit'); setMobileMenuOpen(false); }} />}
      </div>}
      {isFullNav && <div className="pt-4 mt-4 border-t border-slate-100">
        <p className="px-4 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Activity &amp; Operations</p>
        <SidebarItem icon={Activity} label="Activity Logs" active={activePage === 'activity-logs'} onClick={() => { setActivePage('activity-logs'); setMobileMenuOpen(false); }} />
        <SidebarItem icon={BarChart3} label="Operational Insights" active={activePage === 'activity-analytics'} onClick={() => { setActivePage('activity-analytics'); setMobileMenuOpen(false); }} />
      </div>}
      {!isDashRole && <div className="pt-4 mt-4 border-t border-slate-100">
        <SidebarItem icon={Users} label="My Profile" active={activePage === 'profile'} onClick={() => { setActivePage('profile'); setMobileMenuOpen(false); }} />
        {user?.role === 'super_admin' && <SidebarItem icon={ShieldCheck} label="Admin Panel" active={activePage === 'admin'} onClick={() => { setActivePage('admin'); setMobileMenuOpen(false); }} />}
      </div>}
    </nav>
  );

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* Desktop Sidebar */}
      {sidebarOpen && !isMobile && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="bg-white border-r border-slate-200 flex-col overflow-hidden shrink-0 flex"
        >
          <div className="p-4 flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200 shrink-0">
              <ShieldCheck size={24} />
            </div>
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="overflow-hidden min-w-0"
            >
              <h1 className="font-bold text-lg leading-tight whitespace-nowrap">Know Harm AI</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold whitespace-nowrap">CONSTRUCTION SAFETY</p>
            </motion.div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="ml-auto p-1.5 hover:bg-slate-100 rounded-lg transition-all flex items-center justify-center shrink-0 font-bold text-slate-500"
            >
              ‹
            </button>
          </div>
          {desktopSidebarNav}
          <div className="p-4 border-t border-slate-100">
            <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 transition-colors">
              <LogOut size={18} /> Logout
            </button>
          </div>
        </motion.aside>
      )}

      {/* Mobile Full-Screen Drawer */}
      {isMobile && mobileMenuOpen && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0 w-full bg-white flex flex-col overflow-y-auto"
          >
            <div className="p-4 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200 shrink-0">
                  <ShieldCheck size={24} />
                </div>
                <div>
<h1 className="font-bold text-lg leading-tight">Know Harm AI</h1>
                   <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">CONSTRUCTION SAFETY</p>
                </div>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            {sidebarNav}
            <div className="p-4 border-t border-slate-100">
              <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={18} /> Logout
              </button>
            </div>
          </motion.aside>
        </div>
      )}

      {/* Floating hamburger button when sidebar is closed */}
      {!sidebarOpen && !isMobile && !mobileMenuOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-3 left-3 z-[55] w-10 h-10 bg-white rounded-xl shadow-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-all active:scale-95"
        >
          <Menu size={20} />
        </button>
      )}
      {/* Mobile hamburger button removed per user request */}

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0">
          {(!isMobile || activePage !== 'audit') && (
          <form onSubmit={handleSearch} className={cn("relative", isMobile || !sidebarOpen ? "flex-1 ml-10" : "flex-1 max-w-xl")}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder={isMobile ? "Search..." : "Search site data, cameras, or incidents..."} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-transparent rounded-lg text-sm focus:bg-white focus:border-slate-200 focus:outline-none transition-all"
            />
          </form>
          )}

          <div className="flex items-center gap-2 md:gap-4">
            <div className="h-8 w-px bg-slate-200 mx-1 md:mx-2" />
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all hidden sm:flex"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
            <button 
              onClick={() => setActivePage('profile')}
              className="flex items-center gap-3 hover:bg-slate-50 p-1 rounded-xl transition-all"
            >
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-900">{user?.name || 'User'}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'ehs' ? 'EHS Engineer' : user?.role === 'sbg' ? 'SBG' : 'Site Engineer'}</p>
              </div>
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 border border-slate-200 overflow-hidden">
                <img src="https://picsum.photos/seed/manager/100/100" alt="Profile" loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </div>

        {/* Camera Modal */}
        {selectedCamera && (
          <div className={cn("fixed inset-0 z-[100] flex items-center justify-center", isMobile ? "p-0" : "p-4 sm:p-6")}>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedCamera(null)}
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={cn("relative w-full shadow-2xl overflow-hidden bg-black", isMobile ? "h-full rounded-none" : "max-w-7xl rounded-2xl")}
              style={isMobile ? {} : { aspectRatio: '16/9', maxHeight: '90vh' }}
            >
              {/* Header with camera info */}
              <div className="absolute top-0 inset-x-0 z-20 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
                <div>
                  <h3 className="text-lg font-bold text-white">{selectedCamera.name}</h3>
                  <p className="text-xs text-slate-300">
                    {selectedCamera.zone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setSelectedCamera(null)}
                    className="text-white/70 hover:text-white transition-colors bg-black/40 backdrop-blur-sm p-2 rounded-full"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
              
              {/* Video - Edge to Edge */}
              <div className="w-full h-full bg-black flex items-center justify-center relative">
                {cameraModalError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-10">
                    <Video size={48} className="mb-3 opacity-20" />
                    <p className="text-sm">Camera feed unavailable</p>
                  </div>
                )}
                <img
                  src={`${selectedCamera.videoUrl}/snapshot?t=${snapshotTs}`}
                  alt="Live Stream"
                  decoding="async"
                  className={`w-full h-full object-contain ${cameraModalError ? 'hidden' : ''}`}
                  onError={() => setCameraModalError(true)}
                  onLoad={() => setCameraModalError(false)}
                />
              </div>
            </motion.div>
          </div>
        )}

        {/* Scroll to Top Button */}
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-8 right-8 z-[90] p-4 bg-blue-600 text-white rounded-2xl shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all"
          >
            <ArrowUp size={24} />
          </motion.button>
        )}

        {/* Summary Modal */}
        {summaryModalOpen && (
          <div className={cn("fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-300", isMobile ? "p-0" : "p-4")}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={cn("bg-white shadow-2xl w-full overflow-hidden flex flex-col", isMobile ? "h-full rounded-none" : "max-w-3xl rounded-[40px] max-h-[90vh]")}
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">Safety Analytics Summary</h3>
                  <p className="text-sm text-slate-500 mt-1">Comprehensive report of site safety performance</p>
                </div>
                <button 
                  onClick={() => setSummaryModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={24} className="text-slate-400" />
                </button>
              </div>

              <div className="p-8 space-y-8 overflow-y-auto">
                {/* Overall Stats */}
                <div className="grid grid-cols-3 gap-6">
                  <div className="p-6 bg-rose-50 rounded-2xl border border-rose-100">
                    <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">Total Incidents</p>
                    <p className="text-3xl font-black text-rose-700 mt-2">{incidents.length}</p>
                    <p className="text-xs text-rose-500 mt-1">Across all zones</p>
                  </div>
                  <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Compliance Rate</p>
                    <p className="text-3xl font-black text-emerald-700 mt-2">94.2%</p>
                    <p className="text-xs text-emerald-500 mt-1">Above target (90%)</p>
                  </div>
                  <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Active Zones</p>
                    <p className="text-3xl font-black text-blue-700 mt-2">{new Set(incidents.map(i => i.cameraZone)).size}</p>
                    <p className="text-xs text-blue-500 mt-1">Monitored areas</p>
                  </div>
                </div>

                {/* Top Issues */}
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-4">Top Safety Issues</h4>
                  <div className="space-y-3">
                    {(() => {
                      const activityCounts = incidents.reduce((acc, inc) => {
                        acc[inc.unsafeActivity] = (acc[inc.unsafeActivity] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>);
                      
                      return Object.entries(activityCounts)
                        .sort((a, b) => (b[1] as number) - (a[1] as number))
                        .slice(0, 5)
                        .map(([activity, count], index) => (
                          <div key={activity} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center",
                                index === 0 ? "bg-rose-100 text-rose-600" :
                                index === 1 ? "bg-orange-100 text-orange-600" :
                                "bg-slate-100 text-slate-600"
                              )}>
                                <AlertTriangle size={16} />
                              </div>
                              <span className="text-sm font-bold text-slate-900">{activity}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full rounded-full",
                                    index === 0 ? "bg-rose-500" :
                                    index === 1 ? "bg-orange-500" :
                                    "bg-slate-500"
      )}


                                  style={{ width: `${((count as number) / incidents.length) * 100}%` }}
                                />
                              </div>
                              <span className="text-sm font-bold text-slate-900 w-12 text-right">{count as number}</span>
                            </div>
                          </div>
                        ));
                    })()}
                  </div>
                </div>

                {/* Zone Analysis */}
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-4">Zone Risk Analysis</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {(() => {
                      const zoneCounts = incidents.reduce((acc, inc) => {
                        acc[inc.cameraZone] = (acc[inc.cameraZone] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>);
                      
                      return Object.entries(zoneCounts)
                        .sort((a, b) => (b[1] as number) - (a[1] as number))
                        .slice(0, 4)
                        .map(([zone, count]) => (
                          <div key={zone} className="p-4 bg-slate-50 rounded-xl">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold text-slate-900">{zone}</span>
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                                (count as number) > 10 ? "bg-rose-100 text-rose-600" :
                                (count as number) > 5 ? "bg-orange-100 text-orange-600" :
                                "bg-emerald-100 text-emerald-600"
                              )}>
                                {(count as number) > 10 ? 'High Risk' : (count as number) > 5 ? 'Medium' : 'Low'}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full rounded-full",
                                  (count as number) > 10 ? "bg-rose-500" :
                                  (count as number) > 5 ? "bg-orange-500" :
                                  "bg-emerald-500"
                                )}
                                style={{ width: `${((count as number) / Math.max(...Object.values(zoneCounts) as number[])) * 100}%` }}
                              />
                            </div>
                            <p className="text-xs text-slate-500 mt-2">{count as number} incidents detected</p>
                          </div>
                        ));
                    })()}
                  </div>
                </div>

                {/* Recommendations */}
                <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                  <h4 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
                    <Zap size={20} className="text-blue-600" />
                    AI Recommendations
                  </h4>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">1</div>
                      <p className="text-sm text-blue-800">Increase monitoring in high-risk zones during afternoon shifts (12-18) when incident rates peak.</p>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">2</div>
                      <p className="text-sm text-blue-800">Conduct additional PPE training focusing on phone detection violations, which show a rising trend.</p>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">3</div>
                      <p className="text-sm text-blue-800">Review safety protocols in zones with "High Risk" classification and consider additional safety measures.</p>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setSummaryModalOpen(false)}
                  className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
                >
                  Close
                </button>
                <button 
                  onClick={() => {
                    // Export summary as PDF or text
                    const summaryText = `
Safety Analytics Summary
Generated: ${new Date().toLocaleString()}

Total Incidents: ${incidents.length}
Compliance Rate: 94.2%
Active Zones: ${new Set(incidents.map(i => i.cameraZone)).size}

Top Issues:
${(() => {
  const activityCounts = incidents.reduce((acc, inc) => {
    acc[inc.unsafeActivity] = (acc[inc.unsafeActivity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return Object.entries(activityCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 5)
    .map(([activity, count]) => `- ${activity}: ${count} incidents`)
    .join('\n');
})()}

Zone Risk Analysis:
${(() => {
  const zoneCounts = incidents.reduce((acc, inc) => {
    acc[inc.cameraZone] = (acc[inc.cameraZone] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return Object.entries(zoneCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([zone, count]) => `- ${zone}: ${count} incidents`)
    .join('\n');
})()}
                    `.trim();
                    
                    const blob = new Blob([summaryText], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Safety_Summary_${new Date().toISOString().split('T')[0]}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
                >
                  <Download size={16} /> Download Summary
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Incident Detail Modal */}
        {selectedIncident && (
          <div className={cn("fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 backdrop-blur-md animate-in fade-in duration-300", isMobile ? "p-0" : "p-4")}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn("bg-white w-full overflow-hidden shadow-2xl flex flex-col", isMobile ? "h-full rounded-none" : "max-w-5xl rounded-3xl max-h-[90vh]")}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                    <AlertTriangle className="text-rose-500" size={24} />
                    Incident Details: {selectedIncident.id}
                  </h3>
                  <p className="text-sm text-slate-500">Recorded on {new Date(selectedIncident.timestamp).toLocaleString()}</p>
                </div>
                <button 
                  onClick={() => setSelectedIncident(null)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {/* Large Image Viewer */}
                <div className="flex-1 bg-slate-900 relative flex items-center justify-center p-4 overflow-hidden">
                  <div 
                    id={`image-container-${selectedIncident.id}`}
                    className="relative w-full h-full flex items-center justify-center transition-transform duration-200"
                    style={{ transform: 'scale(1)', transformOrigin: 'center center' }}
                  >
                    {selectedIncident.hasImage ? (
                      <img loading="lazy" decoding="async"
                        src={`/api/incidents/${selectedIncident.id}/image`} 
                        alt="Incident Frame" 
                        className="max-w-full max-h-full w-auto h-auto object-contain cursor-grab active:cursor-grabbing rounded-lg shadow-2xl"
                        referrerPolicy="no-referrer"
                        style={{ userSelect: 'none', pointerEvents: 'auto' }}
                        onError={(e) => {
                          const imgElement = e.target as HTMLImageElement;
                          imgElement.style.display = 'none';
                          const parent = imgElement.parentElement;
                          if (parent && !parent.querySelector('.no-image-text')) {
                            const noImageDiv = document.createElement('div');
                            noImageDiv.className = 'no-image-text flex items-center justify-center w-full h-full text-slate-400 text-sm font-medium';
                            noImageDiv.textContent = 'No Image Available';
                            parent.appendChild(noImageDiv);
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center w-full h-full text-slate-400 text-sm font-medium">
                        No Image Available
                      </div>
                    )}
                  </div>

                  {/* Zoom Controls Overlay */}
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-800/90 backdrop-blur-md px-4 py-2 rounded-full shadow-2xl z-20">
                    <button 
                      onClick={() => {
                        const container = document.getElementById(`image-container-${selectedIncident.id}`);
                        if (container) {
                          const currentScale = parseFloat(container.style.transform.replace('scale(', '').replace(')', '') || '1');
                          const newScale = Math.min(currentScale + 0.5, 4);
                          container.style.transform = `scale(${newScale})`;
                          container.style.transformOrigin = 'center center';
                        }
                      }}
                      className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors font-bold"
                      title="Zoom In"
                    >
                      +
                    </button>
                    <span className="text-white text-xs font-mono w-12 text-center">100%</span>
                    <button 
                      onClick={() => {
                        const container = document.getElementById(`image-container-${selectedIncident.id}`);
                        if (container) {
                          const currentScale = parseFloat(container.style.transform.replace('scale(', '').replace(')', '') || '1');
                          const newScale = Math.max(currentScale - 0.5, 0.25);
                          container.style.transform = `scale(${newScale})`;
                          container.style.transformOrigin = 'center center';
                        }
                      }}
                      className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors font-bold"
                      title="Zoom Out"
                    >
                      −
                    </button>
                    <div className="w-px h-4 bg-slate-600 mx-1" />
                    <button 
                      onClick={() => {
                        const container = document.getElementById(`image-container-${selectedIncident.id}`);
                        if (container) {
                          container.style.transform = 'scale(1)';
                          container.style.transformOrigin = 'center center';
                        }
                      }}
                      className="p-2 bg-slate-600 text-white rounded-full hover:bg-slate-500 transition-colors text-xs font-bold"
                      title="Reset Zoom"
                    >
                      1:1
                    </button>
                    <div className="w-px h-4 bg-slate-600 mx-1" />
                    <button 
                      onClick={() => {
                        const container = document.getElementById(`image-container-${selectedIncident.id}`);
                        if (container) {
                          container.style.transform = 'scale(2)';
                          container.style.transformOrigin = 'center center';
                        }
                      }}
                      className="px-3 py-2 bg-slate-600 text-white rounded-full hover:bg-slate-500 transition-colors text-xs font-bold"
                      title="Fit to View"
                    >
                      Fit
                    </button>
                  </div>

                  {/* Navigation Arrows */}
                  <button 
                    onClick={() => {
                      const currentIndex = paginatedIncidents.findIndex(i => i.id === selectedIncident.id);
                      const prevIndex = currentIndex > 0 ? currentIndex - 1 : paginatedIncidents.length - 1;
                      setSelectedIncident(paginatedIncidents[prevIndex]);
                    }}
                    className="absolute left-6 top-1/2 -translate-y-1/2 p-3 bg-slate-800/80 backdrop-blur-md text-white rounded-full hover:bg-slate-700 transition-colors z-20"
                    title="Previous Incident"
                  >
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <button 
                    onClick={() => {
                      const currentIndex = paginatedIncidents.findIndex(i => i.id === selectedIncident.id);
                      const nextIndex = currentIndex < paginatedIncidents.length - 1 ? currentIndex + 1 : 0;
                      setSelectedIncident(paginatedIncidents[nextIndex]);
                    }}
                    className="absolute right-6 top-1/2 -translate-y-1/2 p-3 bg-slate-800/80 backdrop-blur-md text-white rounded-full hover:bg-slate-700 transition-colors z-20"
                    title="Next Incident"
                  >
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>

                  {/* Incident Counter */}
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-slate-800/80 backdrop-blur-md px-4 py-2 rounded-full text-white text-xs font-medium z-20">
                    {paginatedIncidents.findIndex(i => i.id === selectedIncident.id) + 1} of {paginatedIncidents.length}
                  </div>
                </div>

                {/* Details Sidebar */}
                <div className="w-full lg:w-80 bg-white border-l border-slate-100 p-6 space-y-6 overflow-y-auto shrink-0">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Detection Type</p>
                      <p className="text-sm font-bold text-slate-900">{selectedIncident.unsafeActivity} Violation</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Location / Zone</p>
                      <p className="text-sm font-bold text-slate-900">{selectedIncident.cameraZone}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">risk</p>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded uppercase",
                        selectedIncident.risk === 'critical' ? "bg-rose-100 text-rose-600" :
                        selectedIncident.risk === 'high' ? "bg-orange-100 text-orange-600" :
                        "bg-blue-100 text-blue-600"
                      )}>
                        {selectedIncident.risk}
                      </span>
                    </div>
                  </div>

                  {selectedIncident.localPath && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-center gap-2">
                        <ImageIcon size={16} className="text-slate-500" />
                        <p className="text-xs font-bold text-slate-900">Local Path</p>
                      </div>
                      <div className="flex gap-2">
                        <input 
                          readOnly 
                          value={selectedIncident.localPath}
                          className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-mono text-slate-600"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(selectedIncident.localPath!);
                            alert('Path copied!');
                          }}
                          className="px-2 py-1.5 bg-slate-600 text-white rounded text-[10px] font-bold hover:bg-slate-700"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedIncident.oneDriveUrl && (
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-3">
                      <div className="flex items-center gap-2">
                        <Cloud size={16} className="text-blue-500" />
                        <p className="text-xs font-bold text-blue-900">OneDrive Link</p>
                      </div>
                      <div className="flex gap-2">
                        <input 
                          readOnly 
                          value={selectedIncident.oneDriveUrl}
                          className="flex-1 px-2 py-1.5 bg-white border border-blue-100 rounded text-[10px] font-mono text-slate-600"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(selectedIncident.oneDriveUrl!);
                            alert('Link copied!');
                          }}
                          className="px-2 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 space-y-3">
                    <button className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all">
                      Acknowledge & Log
                    </button>
                    <button className="w-full py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all">
                      Escalate to Manager
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {selectedActivityLog && (
          <div className={cn("fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-300", isMobile ? "p-0" : "p-4")}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={cn("bg-white shadow-2xl w-full overflow-hidden border border-white/20 flex flex-col", isMobile ? "h-full rounded-none" : "max-w-5xl rounded-[40px] lg:flex-row")}
            >
              <div className="lg:w-2/3 bg-slate-900 aspect-video lg:aspect-auto relative group overflow-hidden">
                <img loading="lazy" decoding="async"
                  src={selectedActivityLog.imageUrl} 
                  alt={formatActivity(selectedActivityLog.activity)}
                  className="w-full h-full object-cover"
                />
                {selectedActivityLog.detections && (
                  <BoundingBoxOverlay detections={selectedActivityLog.detections} />
                )}
                <button 
                  onClick={() => setSelectedActivityLog(null)}
                  className="absolute top-6 left-6 p-2 bg-white/10 backdrop-blur-md hover:bg-rose-500 rounded-full text-white transition-all opacity-0 group-hover:opacity-100 z-10"
                >
                  <X size={20} />
                </button>
                <div className="absolute top-6 right-6 bg-blue-500/20 backdrop-blur-md border border-blue-500/50 text-blue-400 text-[10px] font-bold px-3 py-1 rounded-full">
                  AI DETECTION PREVIEW
                </div>
              </div>

              <div className="lg:w-1/3 p-8 lg:p-10 space-y-8 bg-slate-50 overflow-y-auto max-h-[80vh] lg:max-h-none">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-slate-900">{formatActivity(selectedActivityLog.activity)}</h3>
                    <p className="text-sm text-slate-500 mt-1">{selectedActivityLog.cameraZone}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedActivityLog(null)}
                    className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                  >
                    <X size={24} className="text-slate-400" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Start Time</p>
                    <p className="text-sm font-bold text-slate-900">{selectedActivityLog.startTime}</p>
                  </div>
                  <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">End Time</p>
                    <p className="text-sm font-bold text-slate-900">{selectedActivityLog.endTime}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Activity Status</h4>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-3 h-3 rounded-full animate-pulse",
                        selectedActivityLog.action === 'Completed' ? "bg-emerald-500" :
                        selectedActivityLog.action === 'In Progress' ? "bg-blue-500" :
                        "bg-slate-400"
                      )} />
                      <span className="text-lg font-bold text-slate-900">{selectedActivityLog.action}</span>
                    </div>
                  </div>

                  <div className="p-5 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-200">
                    <h4 className="text-xs font-bold text-blue-100 uppercase tracking-widest mb-2">AI Verification</h4>
                    <p className="text-sm leading-relaxed font-medium">
                      Activity confirmed via visual analysis. Workflow milestone reached according to site schedule.
                    </p>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => setSelectedActivityLog(null)}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                  >
                    Close Preview
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

      </main>

      {/* AI Know Harm AI Assistant — hidden for Site Engineers */}
      {user && user.role !== 'site' && <ChatWidget />}
    </div>
  );
}

