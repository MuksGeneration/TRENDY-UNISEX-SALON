import React, { useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { SessionUser } from '../types';

const SUGGESTED_QUESTIONS = [
  "How much did the salon make today?",
  "How many customers visited today?",
  "Which employee generated the highest sales this month?",
  "How much commission is outstanding?",
  "How much was deducted for lunch this month?",
  "What were the total expenses this week?",
  "Which stock items need restocking?",
  "How many appointments are scheduled tomorrow?",
  "Which services generate the highest revenue?",
  "What is the salon's monthly financial performance?",
];

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
}

export const AiAssistantView: React.FC<{ user: SessionUser }> = ({ user }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init',
      role: 'assistant',
      text: `Hello ${user.name}. Ask any operational or financial question about Trendy Unisex Salon. All answers are computed directly from your stored salon records in UGX and strictly follow your ${user.role} permissions.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const askQuestion = async (questionText: string) => {
    const q = questionText.trim();
    if (!q || loading) return;
    setError('');
    setInput('');

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await apiFetch<{ answer: string; scope: string; generatedAt: string }>('/api/ai/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.answer,
          meta: `Verified Database Scope: ${res.scope} · ${new Date(res.generatedAt).toLocaleTimeString()}`,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI assistant error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 bg-white border border-[#1D1717]/10 rounded-2xl p-5 space-y-4 h-fit">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#E83B84] text-white flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Salon Intelligence Prompts</h3>
            <p className="text-xs text-[#1D1717]/60">Read-only · Grounded in live database</p>
          </div>
        </div>
        <div className="space-y-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => void askQuestion(q)}
              disabled={loading}
              className="w-full text-left px-3 py-2 rounded-xl bg-[#F8EEEB] hover:bg-[#F3BFD3]/50 text-xs font-medium text-[#1D1717] transition-colors cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-8 bg-white border border-[#1D1717]/10 rounded-2xl flex flex-col h-[620px]">
        <div className="p-5 border-b border-[#1D1717]/10 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">AI Business Assistant</h3>
            <p className="text-xs text-[#1D1717]/60">
              Never fabricates figures · Explains calculation formulas &amp; reporting period
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-[#E83B84] text-white'
                    : 'bg-[#F8EEEB] text-[#1D1717] border border-[#1D1717]/10'
                }`}
              >
                <div>{m.text}</div>
                {m.meta && (
                  <div className="text-[10px] text-[#1D1717]/55 font-mono mt-2 pt-1.5 border-t border-[#1D1717]/10">
                    {m.meta}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="text-xs text-[#1D1717]/60 font-mono">
              Querying stored salon database records...
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askQuestion(input);
          }}
          className="p-4 border-t border-[#1D1717]/10 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about today's sales, outstanding commissions, lunch deductions, or low stock..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-[#1D1717]/15 text-xs focus:outline-none focus:border-[#E83B84]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#E83B84] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" /> Ask
          </button>
        </form>
      </div>
    </div>
  );
};
