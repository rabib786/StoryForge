import { Router } from 'express';
import { characterStateProposalManager } from '../models/character-state-proposal.js';

export const proposalsRouter = Router();

// GET /api/proposals/:id
proposalsRouter.get('/:id', (req, res) => {
  try {
    const proposal = characterStateProposalManager.getProposalById(req.params.id);
    res.json({ proposal });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// POST /api/proposals/:id/approve
proposalsRouter.post('/:id/approve', (req, res) => {
  try {
    const proposalId = req.params.id;
    const { branchId } = req.body || {};

    const result = characterStateProposalManager.approveProposal(proposalId, branchId);
    res.json({
      success: true,
      proposal: result.proposal,
      state: result.state,
      alreadyApproved: result.alreadyApproved || false,
    });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('does not belong') || msg.includes('forbidden')) {
      return res.status(403).json({ error: msg });
    }
    if (msg.includes('stale') || msg.includes('Cannot approve') || msg.includes('Invalid')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// POST /api/proposals/:id/reject
proposalsRouter.post('/:id/reject', (req, res) => {
  try {
    const proposalId = req.params.id;
    const { branchId } = req.body || {};

    const updated = characterStateProposalManager.rejectProposal(proposalId, branchId);
    res.json({
      success: true,
      proposal: updated,
    });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('does not belong') || msg.includes('forbidden')) {
      return res.status(403).json({ error: msg });
    }
    if (msg.includes('Cannot reject')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});
