import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';

// Remote tool approval (the ⭐ capability): the card leaves the list only
// after the decision POST lands — a dropped decision would look granted
// while the tool times out into a deny.
class ApprovalCard extends StatelessWidget {
  const ApprovalCard({super.key, required this.request});

  final ToolApprovalRequest request;

  @override
  Widget build(BuildContext context) {
    final model = context.read<ApprovalsModel>();
    final summary = request.input.isEmpty
        ? ''
        : jsonEncode(request.input);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7E6),
        border: Border.all(color: Colors.orange),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('⏳'),
              const SizedBox(width: 6),
              Text(request.toolName,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(summary,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: Colors.grey[700])),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              FilledButton(
                onPressed: () => model.decide(request.approvalId, 'allow'),
                style: FilledButton.styleFrom(backgroundColor: Colors.green),
                child: const Text('批准'),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () => model.decide(request.approvalId, 'deny'),
                style: FilledButton.styleFrom(backgroundColor: Colors.red),
                child: const Text('拒绝'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
