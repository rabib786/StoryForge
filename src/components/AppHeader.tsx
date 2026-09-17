import React, { useState } from 'react';
import { Sparkles, Download, Check, HelpCircle } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface AppHeaderProps {
  title?: string;
  activeProviderName?: string;
  onNavigateHome?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  activeProviderName = 'Gemini 2.5 Flash',
  onNavigateHome,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-[#0b0f19]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between">
      {/* Brand / Title */}
      <div
        onClick={onNavigateHome}
        className="flex items-center gap-2.5 cursor-pointer select-none group"
      >
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 via-amber-600/10 to-transparent border border-amber-500/30 flex items-center justify-center shadow-inner">
          <Sparkles className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform duration-200" />
        </div>
        <div className="flex flex-col">
          <span className="font-display text-base font-bold tracking-wide text-slate-100 flex items-center gap-1.5">
            StoryForge
          </span>
          {title && (
            <span className="text-[11px] text-slate-400 font-medium truncate max-w-[140px] sm:max-w-xs">
              {title}
            </span>
          )}
        </div>
      </div>

      {/* Right controls: Active Model & PWA install */}
      <div className="flex items-center gap-2">
        {/* Model Indicator Pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="truncate max-w-[120px]">{activeProviderName}</span>
        </div>

        {/* PWA Install Button */}
        {!isInstalled && isInstallable && (
          <button
            onClick={install}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/25 transition active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install</span>
          </button>
        )}

        {!isInstalled && isIOS && (
          <>
            <button
              onClick={() => setShowIOSGuide(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-medium hover:bg-slate-700 transition"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>

            {showIOSGuide && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl">
                  <h3 className="text-base font-semibold text-white mb-2 font-display">Install StoryForge on iOS</h3>
                  <p className="text-xs text-slate-300 leading-relaxed space-y-1.5">
                    1. Tap the <strong className="text-amber-400">Share</strong> button in Safari's bottom toolbar.<br />
                    2. Scroll down and tap <strong className="text-amber-400">Add to Home Screen</strong>.<br />
                    3. Launch StoryForge for full-screen immersive reading!
                  </p>
                  <button
                    onClick={() => setShowIOSGuide(false)}
                    className="mt-5 w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-xs transition"
                  >
                    Got It
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {isInstalled && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium">
            <Check className="w-3 h-3" />
            <span className="hidden xs:inline">Installed</span>
          </div>
        )}
      </div>
    </header>
  );
};
