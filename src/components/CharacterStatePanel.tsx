import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { CharacterStateResponse, CharacterStateProposal } from '../types';
import { Users, AlertCircle, RefreshCw, Sparkles, Check, X, Clock } from 'lucide-react';

interface Props {
  activeBranchId: string | null;
  refreshTrigger?: number;
}

export function CharacterStatePanel({ activeBranchId, refreshTrigger = 0 }: Props) {
  const [data, setData] = useState<CharacterStateResponse | null>(null);
  const [proposals, setProposals] = useState<CharacterStateProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'states' | 'proposals'>('all');

  const fetchData = useCallback(async () => {
    if (!activeBranchId) {
      setData(null);
      setProposals([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [stateRes, propRes] = await Promise.all([
        api.getCharacterStates(activeBranchId),
        api.getBranchProposals(activeBranchId),
      ]);
      setData(stateRes);
      setProposals(propRes.proposals || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load character states');
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  const handleApprove = async (proposalId: string) => {
    if (!activeBranchId) return;
    setActionLoading(proposalId);
    try {
      await api.approveProposal(proposalId, activeBranchId);
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve proposal');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    if (!activeBranchId) return;
    setActionLoading(proposalId);
    try {
      await api.rejectProposal(proposalId, activeBranchId);
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject proposal');
    } finally {
      setActionLoading(null);
    }
  };

  if (!activeBranchId) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-slate-500">
        <Users className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm">No active branch selected.</p>
      </div>
    );
  }

  if (loading && !data && proposals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <div className="w-6 h-6 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin mb-3" />
        <span className="text-xs font-medium">Resolving character states...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <AlertCircle className="w-8 h-8 text-rose-500/80 mb-3" />
        <p className="text-sm text-rose-400 font-medium mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const pendingProposals = proposals.filter(p => p.status === 'pending');

  return (
    <div className="flex flex-col space-y-4 p-4">
      {/* Header controls & filter tabs */}
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-800">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('all')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              viewMode === 'all'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setViewMode('states')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              viewMode === 'states'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Timeline States
          </button>
          <button
            onClick={() => setViewMode('proposals')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition ${
              viewMode === 'proposals'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Proposals</span>
            {pendingProposals.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950">
                {pendingProposals.length}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="p-1 rounded text-slate-400 hover:text-slate-200 transition"
          title="Refresh character states"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error banner if any */}
      {error && (
        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Pending Proposals Section */}
      {(viewMode === 'all' || viewMode === 'proposals') && pendingProposals.length > 0 && (
        <div className="rounded-xl bg-amber-950/20 border border-amber-500/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                AI Character State Proposals
              </h4>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {pendingProposals.length} pending
            </span>
          </div>

          <div className="space-y-2">
            {pendingProposals.map((proposal) => {
              const isLoadingThis = actionLoading === proposal.id;
              const displayKey = proposal.state_key
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

              let displayVal = proposal.proposed_value;
              if (displayVal === null) displayVal = 'Cleared (null)';

              return (
                <div
                  key={proposal.id}
                  className="rounded-lg bg-slate-900/90 border border-amber-500/20 p-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-200">
                          {proposal.character_name || proposal.character_id}
                        </span>
                        <span className="text-[10px] text-slate-500">→</span>
                        <span className="text-[11px] font-semibold text-amber-400">
                          {displayKey}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-300">
                        Proposed: <span className="font-mono font-semibold text-emerald-400">{String(displayVal)}</span>
                      </div>
                      {proposal.reason && (
                        <p className="mt-1 text-[11px] text-slate-400 italic">
                          "{proposal.reason}"
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleApprove(proposal.id)}
                        disabled={isLoadingThis}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition disabled:opacity-50"
                        title="Approve and apply to canonical timeline"
                      >
                        <Check className="w-3 h-3" />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => handleReject(proposal.id)}
                        disabled={isLoadingThis}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-medium transition disabled:opacity-50"
                        title="Reject proposal"
                      >
                        <X className="w-3 h-3" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Proposals list in 'proposals' view */}
      {viewMode === 'proposals' && proposals.filter(p => p.status !== 'pending').length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            Proposal History
          </h5>
          <div className="space-y-1.5">
            {proposals.filter(p => p.status !== 'pending').map((p) => (
              <div
                key={p.id}
                className="rounded-lg bg-slate-900/40 border border-slate-800 p-2 flex items-center justify-between text-xs"
              >
                <div className="truncate">
                  <span className="text-slate-300 font-medium">{p.character_name || p.character_id}</span>
                  <span className="text-slate-500 mx-1.5">·</span>
                  <span className="text-slate-400">{p.state_key}: {String(p.proposed_value)}</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    p.status === 'approved'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Canonical States per Character */}
      {(viewMode === 'all' || viewMode === 'states') && (
        <div className="space-y-4">
          {(!data || data.characters.length === 0) ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500 text-center">
              <Users className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-sm font-medium">No canonical characters.</p>
              <p className="text-xs mt-1">Add characters to the chronicle to track their state.</p>
            </div>
          ) : (
            data.characters.map((char) => {
              const hasDynamicState = char.states.length > 0;
              
              return (
                <div key={char.characterId} className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
                  {/* Canonical Info Header */}
                  <div className="p-3 bg-slate-800/40 border-b border-slate-800/80 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-200 text-sm">{char.characterName}</h4>
                      {char.role && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-700/50 text-slate-400">
                          {char.role}
                        </span>
                      )}
                    </div>
                    
                    {char.personality && (
                      <p className="text-xs text-slate-400 truncate" title={char.personality}>
                        <span className="font-semibold text-slate-500">Personality:</span> {char.personality}
                      </p>
                    )}
                  </div>

                  {/* Dynamic State Body */}
                  <div className="p-3 bg-[#0b0f19]/30">
                    <h5 className="text-[10px] font-bold text-amber-500/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500/50"></span>
                      Current Timeline State
                    </h5>
                    
                    {!hasDynamicState ? (
                      <p className="text-xs text-slate-500 italic py-1">
                        No dynamic states established yet.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {char.states.map((state) => {
                          let displayValue = state.value;
                          if (typeof displayValue === 'boolean') {
                            displayValue = displayValue ? 'Yes' : 'No';
                          } else if (displayValue === null || displayValue === undefined) {
                            displayValue = 'Unknown';
                          }

                          const displayKey = state.key
                            .split('_')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                            .join(' ');

                          return (
                            <div key={state.key} className="flex justify-between items-center bg-slate-900/80 rounded border border-slate-800 px-2 py-1.5">
                              <span className="text-[11px] font-medium text-slate-400">{displayKey}</span>
                              <span className="text-[11px] font-bold text-slate-200 text-right line-clamp-1 ml-2" title={String(displayValue)}>
                                {String(displayValue)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
