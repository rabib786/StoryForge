// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { CharacterStatePanel } from '../src/components/CharacterStatePanel';
import { api } from '../src/services/api';

vi.mock('../src/services/api', () => ({
  api: {
    getCharacterStates: vi.fn(),
    getBranchProposals: vi.fn().mockResolvedValue({ proposals: [] }),
  }
}));

describe('Phase 5.7 Character State Frontend Test Suite', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('1. API client calls the correct branch-scoped endpoint.', async () => {
    vi.mocked(api.getCharacterStates).mockResolvedValue({
      branchId: 'branch-1',
      sessionId: 'sess-1',
      characters: []
    });
    render(<CharacterStatePanel activeBranchId="branch-1" />);
    expect(api.getCharacterStates).toHaveBeenCalledWith('branch-1');
  });

  it('3. Character states render from the API response.', async () => {
    vi.mocked(api.getCharacterStates).mockResolvedValue({
      branchId: 'branch-1',
      sessionId: 'sess-1',
      characters: [{
        characterId: 'char-1',
        characterName: 'Mira',
        role: 'Spy',
        states: [
          { key: 'alive', value: true },
          { key: 'health_status', value: 'wounded' }
        ]
      }]
    });

    render(<CharacterStatePanel activeBranchId="branch-1" />);

    expect(await screen.findByText('Mira')).toBeDefined();
    expect(screen.getByText('Spy')).toBeDefined();
    expect(screen.getByText('Alive')).toBeDefined();
    expect(screen.getByText('Yes')).toBeDefined();
    expect(screen.getByText('Health Status')).toBeDefined();
    expect(screen.getByText('wounded')).toBeDefined();
  });

  it('9. Empty state collection renders correctly.', async () => {
    vi.mocked(api.getCharacterStates).mockResolvedValue({
      branchId: 'branch-1',
      sessionId: 'sess-1',
      characters: [{
        characterId: 'char-1',
        characterName: 'Mira',
        role: 'Spy',
        states: []
      }]
    });

    render(<CharacterStatePanel activeBranchId="branch-1" />);
    
    expect(await screen.findByText('Mira')).toBeDefined();
    expect(screen.getByText('No dynamic states established yet.')).toBeDefined();
    expect(screen.queryByText('Alive')).toBeNull();
  });

  it('11. Branch switch causes a new branch-specific state request.', async () => {
    vi.mocked(api.getCharacterStates).mockImplementation(async (branchId) => {
      return { branchId, sessionId: 'sess', characters: [] };
    });

    const { rerender } = render(<CharacterStatePanel activeBranchId="branch-1" />);
    await screen.findByText('No canonical characters.');
    expect(api.getCharacterStates).toHaveBeenCalledWith('branch-1');

    rerender(<CharacterStatePanel activeBranchId="branch-2" />);
    await screen.findByText('No canonical characters.');
    expect(api.getCharacterStates).toHaveBeenCalledWith('branch-2');
  });

  it('13. API failure renders a safe error state.', async () => {
    vi.mocked(api.getCharacterStates).mockRejectedValue(new Error('Network error'));
    render(<CharacterStatePanel activeBranchId="branch-error" />);
    
    expect(await screen.findByText('Network error')).toBeDefined();
    expect(screen.getByText('Retry')).toBeDefined();
  });
  
  it('24. Empty branch does not inherit another branch state.', async () => {
      vi.mocked(api.getCharacterStates).mockResolvedValue({
        branchId: 'empty-branch',
        sessionId: 'sess-1',
        characters: []
      });

      render(<CharacterStatePanel activeBranchId="empty-branch" />);
      expect(await screen.findByText('No canonical characters.')).toBeDefined();
  });
});
