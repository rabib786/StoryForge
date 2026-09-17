import React, { useState } from 'react';
import { User, Plus, Edit2, Trash2, X } from 'lucide-react';
import { Persona } from '../types';
import { api } from '../services/api';

interface PersonaManagerProps {
  personas: Persona[];
  onRefresh: () => void;
}

export const PersonaManager: React.FC<PersonaManagerProps> = ({
  personas,
  onRefresh,
}) => {
  const [editingPersona, setEditingPersona] = useState<Partial<Persona> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartCreate = () => {
    setError(null);
    setEditingPersona({
      name: '',
      pronouns: '',
      appearance: '',
      personality: '',
      background: '',
      traits: '',
      role: '',
      instructions: '',
      avatar_path: '',
    });
  };

  const handleStartEdit = (persona: Persona) => {
    setError(null);
    setEditingPersona({ ...persona });
  };

  const handleSave = async () => {
    if (!editingPersona?.name?.trim()) {
      setError('Persona name is required');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (editingPersona.id) {
        await api.updatePersona(editingPersona.id, editingPersona);
      } else {
        await api.createPersona(editingPersona);
      }
      setEditingPersona(null);
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete persona "${name}"?`)) return;
    try {
      await api.deletePersona(id);
      onRefresh();
    } catch (err: unknown) {
      alert(`Error deleting persona: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-5 space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-white tracking-wide">
            Player Personas
          </h1>
          <p className="text-xs text-slate-400">
            Define the global identities you can play as across different Chronicles.
          </p>
        </div>

        <button
          onClick={handleStartCreate}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition shadow active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>New Persona</span>
        </button>
      </div>

      {/* Persona Cards Grid */}
      {personas.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {personas.map((persona) => (
            <div
              key={persona.id}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between group hover:border-slate-700 transition"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold text-white shadow-md shrink-0 border border-white/10 bg-indigo-600">
                      {persona.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-slate-100 truncate text-sm">
                          {persona.name}
                        </h3>
                      </div>
                      {persona.role && (
                        <p className="text-xs text-slate-400 truncate">{persona.role}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                    <button
                      onClick={() => handleStartEdit(persona)}
                      className="p-1.5 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 transition"
                      title="Edit Persona"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(persona.id, persona.name)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
                      title="Delete Persona"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {persona.background && (
                  <p className="mt-3 text-xs text-slate-300 font-prose text-[13px] line-clamp-2 leading-relaxed">
                    {persona.background}
                  </p>
                )}
                {persona.personality && (
                  <p className="mt-2 text-xs text-slate-400 font-prose text-[12px] line-clamp-1 italic">
                    {persona.personality}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center space-y-3">
          <User className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-300">No Personas</h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Create a Player Persona to establish who you are when you enter a Chronicle.
          </p>
        </div>
      )}

      {/* Editor Modal */}
      {editingPersona && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-[#0e1320] border border-slate-700/80 p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="font-display text-base font-bold text-white">
                {editingPersona.id ? 'Edit Persona' : 'Create New Persona'}
              </h2>
              <button
                onClick={() => setEditingPersona(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={editingPersona.name || ''}
                  onChange={(e) => setEditingPersona({ ...editingPersona, name: e.target.value })}
                  placeholder="e.g. Valen Thorne"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500/80"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Pronouns
                </label>
                <input
                  type="text"
                  value={editingPersona.pronouns || ''}
                  onChange={(e) => setEditingPersona({ ...editingPersona, pronouns: e.target.value })}
                  placeholder="e.g. He/Him"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500/80"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Role / Archetype
              </label>
              <input
                type="text"
                value={editingPersona.role || ''}
                onChange={(e) => setEditingPersona({ ...editingPersona, role: e.target.value })}
                placeholder="e.g. Wandering Scholar, Detective"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500/80"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Appearance
              </label>
              <textarea
                rows={2}
                value={editingPersona.appearance || ''}
                onChange={(e) => setEditingPersona({ ...editingPersona, appearance: e.target.value })}
                placeholder="Tall, weather-beaten cloak, piercing blue eyes..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500/80 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Background
              </label>
              <textarea
                rows={2}
                value={editingPersona.background || ''}
                onChange={(e) => setEditingPersona({ ...editingPersona, background: e.target.value })}
                placeholder="Grew up in the lower sectors. Learned to hack before learning to read."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500/80 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Personality
              </label>
              <textarea
                rows={2}
                value={editingPersona.personality || ''}
                onChange={(e) => setEditingPersona({ ...editingPersona, personality: e.target.value })}
                placeholder="Resourceful, dry sense of humor, protective of allies."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500/80 resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingPersona(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-bold transition shadow"
              >
                {saving ? 'Saving...' : 'Save Persona'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
