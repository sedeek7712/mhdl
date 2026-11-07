import React, { useState } from 'react';
import { FLUTTER_CLEAN_CODE_FILES, PROJECT_EXECUTION_PHASES, FlutterCodeFile } from '../data/flutterCleanArchitectureData';
import { ArrowLeftRight, Check, Code2, Copy, Cpu, Download, FileCode, FolderTree, Layers, Monitor, Smartphone, Terminal, Waypoints } from 'lucide-react';

export const CleanArchitectureFlutterView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<FlutterCodeFile>(FLUTTER_CLEAN_CODE_FILES[0]);
  const [activeTab, setActiveTab] = useState<'code' | 'phases' | 'architecture_diagram'>('code');
  const [selectedLayer, setSelectedLayer] = useState<string>('All');
  const [copied, setCopied] = useState(false);

  const filteredFiles = selectedLayer === 'All'
    ? FLUTTER_CLEAN_CODE_FILES
    : FLUTTER_CLEAN_CODE_FILES.filter((f) => f.layer === selectedLayer);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([selectedFile.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedFile.path.split('/').pop() || 'clean_code.dart';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 border border-cyan-850/60 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              CROSS-PLATFORM FLUTTER & DART ENGINE
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-300">Clean Architecture / كود نظيف مقسم الطبقات</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-cyan-400" />
            <span>معمارية النظام المالي بلغة Dart وإطار عمل Flutter</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
            تصميم هندسي متكامل يعمل على جميع أنظمة التشغيل (Windows, macOS, Linux, Android, iOS, Web) مع استقلالية تامة
            لقواعد العمل المحاسبي (Domain) عن واجهات المستخدم (Presentation) وقواعد البيانات (Data).
          </p>
        </div>

        {/* View Switchers */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-800 rounded-xl overflow-x-auto w-full md:w-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('code')}
            className={`whitespace-nowrap px-3.5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'code' ? 'bg-cyan-600 text-white shadow' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Code2 className="w-4 h-4 shrink-0" />
            <span>مستعرض ملفات Dart</span>
          </button>
          <button
            onClick={() => setActiveTab('phases')}
            className={`whitespace-nowrap px-3.5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'phases' ? 'bg-cyan-600 text-white shadow' : 'text-slate-300 hover:text-white'
            }`}
          >
            <FolderTree className="w-4 h-4 shrink-0" />
            <span>المراحل الخمس للتنفيذ</span>
          </button>
          <button
            onClick={() => setActiveTab('architecture_diagram')}
            className={`whitespace-nowrap px-3.5 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'architecture_diagram' ? 'bg-cyan-600 text-white shadow' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Waypoints className="w-4 h-4 shrink-0" />
            <span>مخطط سريان الطبقات</span>
          </button>
        </div>
      </div>

      {/* Target Platforms Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center flex flex-col items-center justify-center">
          <Monitor className="w-5 h-5 text-sky-400 mb-1" />
          <span className="text-xs font-bold text-white">Windows</span>
          <span className="text-[10px] text-slate-400 font-mono">x64 / POS Ready</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center flex flex-col items-center justify-center">
          <Monitor className="w-5 h-5 text-emerald-400 mb-1" />
          <span className="text-xs font-bold text-white">macOS</span>
          <span className="text-[10px] text-slate-400 font-mono">Apple Silicon / Intel</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center flex flex-col items-center justify-center">
          <Terminal className="w-5 h-5 text-amber-400 mb-1" />
          <span className="text-xs font-bold text-white">Linux</span>
          <span className="text-[10px] text-slate-400 font-mono">Ubuntu / Debian</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center flex flex-col items-center justify-center">
          <Smartphone className="w-5 h-5 text-teal-400 mb-1" />
          <span className="text-xs font-bold text-white">Android</span>
          <span className="text-[10px] text-slate-400 font-mono">Phones & Tablets</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center flex flex-col items-center justify-center">
          <Smartphone className="w-5 h-5 text-slate-300 mb-1" />
          <span className="text-xs font-bold text-white">iOS</span>
          <span className="text-[10px] text-slate-400 font-mono">iPhone & iPad</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center flex flex-col items-center justify-center">
          <Cpu className="w-5 h-5 text-purple-400 mb-1" />
          <span className="text-xs font-bold text-white">Web / WASM</span>
          <span className="text-[10px] text-slate-400 font-mono">Single-Page App</span>
        </div>
      </div>

      {/* 1. Code Explorer View */}
      {activeTab === 'code' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* File Tree & Layer Filter (4 cols) */}
          <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <FolderTree className="w-4 h-4 text-cyan-400" />
                <span>هيكل ملفات Flutter النظيفة</span>
              </span>
              <span className="text-[10px] font-mono text-cyan-400">lib/</span>
            </div>

            {/* Layer Filter buttons */}
            <div className="flex flex-wrap gap-1.5">
              {['All', 'Domain', 'Data', 'Presentation', 'Core'].map((l) => (
                <button
                  key={l}
                  onClick={() => setSelectedLayer(l)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors ${
                    selectedLayer === l
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-850 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {l === 'All' ? 'كافة الطبقات' : l}
                </button>
              ))}
            </div>

            {/* File list */}
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {filteredFiles.map((f) => {
                const isSelected = selectedFile.path === f.path;
                return (
                  <button
                    key={f.path}
                    onClick={() => setSelectedFile(f)}
                    className={`w-full text-right p-3 rounded-xl border transition-all text-xs space-y-1 block ${
                      isSelected
                        ? 'bg-cyan-950/60 border-cyan-500/50 text-white'
                        : 'bg-slate-850/60 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{f.titleAr}</span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                          f.layer === 'Domain'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : f.layer === 'Data'
                            ? 'bg-amber-500/10 text-amber-400'
                            : f.layer === 'Presentation'
                            ? 'bg-purple-500/10 text-purple-400'
                            : 'bg-cyan-500/10 text-cyan-400'
                        }`}
                      >
                        {f.layer}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 truncate" dir="ltr">
                      {f.path}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Code Viewer (8 cols) */}
          <div className="lg:col-span-8 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold text-white">{selectedFile.titleAr}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                    طبقة {selectedFile.layer}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{selectedFile.descriptionAr}</p>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5" dir="ltr">
                  {selectedFile.path}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'تم النسخ' : 'نسخ الكود'}</span>
                </button>
                <button
                  onClick={handleDownloadFile}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير Dart</span>
                </button>
              </div>
            </div>

            {/* Code editor view with line numbers and syntax styling */}
            <div className="relative bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs text-slate-200 overflow-x-auto max-h-[560px] leading-relaxed" dir="ltr">
              <pre className="whitespace-pre">
                <code>{selectedFile.code}</code>
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      {/* 2. 5-Phase Project Roadmap View */}
      {activeTab === 'phases' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="pb-3 border-b border-slate-800">
            <h2 className="text-lg font-bold text-white">مراحل تنفيذ وتطوير المشروع الخمس (Project Roadmap)</h2>
            <p className="text-xs text-slate-400 mt-1">
              خارطة الطريق المعتمدة في الصفحة الرابعة (البند 12.1) من وثيقة متطلبات نظام عمرو النماري للصرافة:
            </p>
          </div>

          <div className="space-y-4">
            {PROJECT_EXECUTION_PHASES.map((phase) => (
              <div
                key={phase.number}
                className="bg-slate-850 border border-slate-800 rounded-xl p-5 hover:border-cyan-800/50 transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-lg bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold text-sm">
                      {phase.number}
                    </span>
                    <h3 className="text-sm font-bold text-white">{phase.titleAr}</h3>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    مكتملة ومبرمجة 100%
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{phase.objectiveAr}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                  {phase.deliverablesAr.map((deliv, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-slate-400">
                      <span className="text-cyan-400 mt-0.5">✓</span>
                      <span>{deliv}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-800">
                  {phase.technicalStack.map((tech) => (
                    <span
                      key={tech}
                      className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 3. Architecture Flow Diagram */}
      {activeTab === 'architecture_diagram' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="pb-3 border-b border-slate-800">
            <h2 className="text-lg font-bold text-white">مخطط سريان البيانات وتقسيم الطبقات (Clean Architecture)</h2>
            <p className="text-xs text-slate-400 mt-1">
              قواعد الاعتمادية (Dependency Rule): لا يمكن لأي طبقة داخلية معرفة تفاصيل الطبقات الخارجية؛ يتدفق التحكم عبر الواجهات البرمجية (Interfaces).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
            {/* Presentation */}
            <div className="bg-purple-950/40 border border-purple-800/40 rounded-2xl p-5 space-y-3">
              <span className="text-xs font-mono font-bold text-purple-400 block uppercase">1. Presentation Layer</span>
              <h3 className="text-base font-bold text-white">واجهات المستخدم (UI & BLoC)</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Widgets تكيفية تدعم الشاشات اللمسية والهواتف والـ Desktop، استقبال مدخلات الصراف، وإطلاق أحداث BLoC / Riverpod.
              </p>
              <div className="text-[10px] font-mono text-purple-300 bg-purple-900/30 p-2 rounded-lg" dir="ltr">
                VoucherScreen ➔ ExchangeBloc
              </div>
            </div>

            {/* Domain */}
            <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-2xl p-5 space-y-3">
              <span className="text-xs font-mono font-bold text-emerald-400 block uppercase">2. Domain Layer (Pure)</span>
              <h3 className="text-base font-bold text-white">حالات الاستخدام والكيانات</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                قلب النظام المالي بدون أي تبعيات لإطار Flutter أو واجهات العرض. تطبيق قواعد القيد المزدوج، وصلاحيات العمليات.
              </p>
              <div className="text-[10px] font-mono text-emerald-300 bg-emerald-900/30 p-2 rounded-lg" dir="ltr">
                ExecuteExchangeUseCase ➔ Entity
              </div>
            </div>

            {/* Data */}
            <div className="bg-amber-950/40 border border-amber-800/40 rounded-2xl p-5 space-y-3">
              <span className="text-xs font-mono font-bold text-amber-400 block uppercase">3. Data Layer</span>
              <h3 className="text-base font-bold text-white">المستودعات ومصادر البيانات</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                تنفيذ عقود المستودعات (Repository Impl)، تحويل النماذج JSON Models، والتعامل مع قاعدة بيانات SQLite / Drift المحلية.
              </p>
              <div className="text-[10px] font-mono text-amber-300 bg-amber-900/30 p-2 rounded-lg" dir="ltr">
                AccountingRepositoryImpl ➔ DB
              </div>
            </div>

            {/* Core & Offline Sync */}
            <div className="bg-cyan-950/40 border border-cyan-800/40 rounded-2xl p-5 space-y-3">
              <span className="text-xs font-mono font-bold text-cyan-400 block uppercase">4. Core & Sync Engine</span>
              <h3 className="text-base font-bold text-white">النواة وإدارة العمل دون إنترنت</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                طابور المزامنة التلقائية (Sync Queue)، فحص توازن المدين والدائن لحظياً، والتفقيط المالي بالريال والدولار.
              </p>
              <div className="text-[10px] font-mono text-cyan-300 bg-cyan-900/30 p-2 rounded-lg" dir="ltr">
                DoubleEntryEngine ➔ OfflineSync
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
