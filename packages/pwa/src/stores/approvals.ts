import { defineStore } from 'pinia';
import type { ApprovalDecision, ToolApprovalRequest } from '@ccferry/protocol';
import { apiFetch } from '../lib/api';

export const useApprovalsStore = defineStore('approvals', {
  state: () => ({
    pending: [] as ToolApprovalRequest[],
  }),
  actions: {
    ingest(request: ToolApprovalRequest) {
      if (!this.pending.some((p) => p.approvalId === request.approvalId)) this.pending.push(request);
    },
    async decide(approvalId: string, decision: ApprovalDecision) {
      this.pending = this.pending.filter((p) => p.approvalId !== approvalId);
      await apiFetch(`/api/approvals/${approvalId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
    },
    sweepExpired() {
      const now = Date.now();
      this.pending = this.pending.filter((p) => now - p.createdAtMs < p.timeoutMs);
    },
  },
});
