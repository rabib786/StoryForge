import React, { useState } from 'react';
import { Branch } from '../types';
import { GitFork, RotateCcw, Trash2, Edit2, Play, GitBranch, History, Clock } from 'lucide-react';

interface BranchNavigatorProps {
  branches: Branch[];
  activeBranchId: string | null;
  onSwitchBranch: (branchId: string) => void;
  onRenameBranch: (branchId: string, name: string) => void;
  onDeleteBranch: (branchId: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const BranchNavigator: React.FC<BranchNavigatorProps> = ({
  branches,
  activeBranchId,
  onSwitchBranch,
  onRenameBranch,
  onDeleteBranch,
  isOpen,
  onClose
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  if (!isOpen) return null;

  const activeBranches = branches.filter(b => !b.is_archived);
  const archivedBranches = branches.filter(b => b.is_archived);

  const startRename = (b: Branch) => {
    setEditingId(b.id);
    setEditName(b.name);
  };

  const handleRename = (id: string) => {
    if (editName.trim()) {
      onRenameBranch(id, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-slate-900 border-l border-slate-800 shadow-2xl z-40 flex flex-col transform transition-transform">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="font-display font-bold text-white flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-amber-400" />
          Timelines
        </h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400">
          &times;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Active Timelines */}
        <div>
          <div className="px-2 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Active Timelines
          </div>
          <div className="space-y-1">
            {activeBranches.map(b => (
              <div 
                key={b.id} 
                className={`p-2 rounded-lg flex items-center justify-between group transition ${
                  b.id === activeBranchId 
                    ? 'bg-amber-950/30 border border-amber-500/30' 
                    : 'hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {editingId === b.id ? (
                  <input
                    className="flex-1 bg-slate-950 border border-amber-500/50 rounded px-2 py-1 text-sm text-white focus:outline-none mr-2"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => handleRename(b.id)}
                    onKeyDown={e => e.key === 'Enter' && handleRename(b.id)}
                    autoFocus
                  />
                ) : (
                  <button 
                    onClick={() => onSwitchBranch(b.id)}
                    className="flex-1 text-left flex items-center gap-2"
                  >
                    <div className={`w-2 h-2 rounded-full ${b.id === activeBranchId ? 'bg-amber-400' : 'bg-slate-600'}`} />
                    <span className={`text-sm ${b.id === activeBranchId ? 'text-amber-100 font-semibold' : 'text-slate-300'}`}>
                      {b.name}
                    </span>
                  </button>
                )}
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startRename(b)} className="p-1 text-slate-500 hover:text-white rounded hover:bg-slate-700">
                    <Edit2 className="w-3 h-3" />
                  </button>
                  {b.id !== activeBranchId && activeBranches.length > 1 && (
                    <button onClick={() => onDeleteBranch(b.id)} className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-700">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Archived Timelines */}
        {archivedBranches.length > 0 && (
          <div>
            <div className="px-2 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <History className="w-3 h-3" /> Archived Snapshots
            </div>
            <div className="space-y-1">
              {archivedBranches.map(b => (
                <div 
                  key={b.id} 
                  className={`p-2 rounded-lg flex items-center justify-between group transition ${
                    b.id === activeBranchId 
                      ? 'bg-slate-800/80 border border-slate-600' 
                      : 'hover:bg-slate-800/50 border border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <button 
                    onClick={() => onSwitchBranch(b.id)}
                    className="flex-1 text-left flex items-center gap-2"
                  >
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className={`text-sm text-slate-400 line-clamp-1`}>
                      {b.name}
                    </span>
                  </button>
                  {b.id !== activeBranchId && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onDeleteBranch(b.id)} className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-700">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
