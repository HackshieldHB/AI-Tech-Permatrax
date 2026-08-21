import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.types';
import {
  AiKnowledgeService,
  type RetrievedChunk,
} from './ai-knowledge.service';
import { AiOllamaService } from './ai-ollama.service';
import { AiToolsService, type ToolTrace } from './ai-tools.service';
import {
  answerFingerprint,
  buildCapabilityAnswer,
  buildClarificationPrompt,
  buildCorrectionAckWithRetry,
  buildCorrectionRecoveryAnswer,
  buildCorrectionSameResult,
  buildActiveReferenceDetailAnswer,
  buildModuleAck,
  buildRecoveryAnswer,
  buildRecoveryFailedAnswer,
  buildScopeClarificationPrompt,
  buildUnknownAnswer,
  buildUnsupportedDataAnswer,
  classifyFailureFromTools,
  classifyPaIntent,
  detectRequestedAttribute,
  extractActiveReferenceFromAnswer,
  extractEntityFromAnswer,
  extractExplicitEntityCode,
  hasConversationalReference,
  isActiveReferenceDetailQuery,
  isAttributeFollowUp,
  isConversationStateFollowUp,
  isExplicitModuleSwitch,
  isFinanceFilterOrAggregateQuery,
  isFinanceContextFilterQuery,
  isFinanceFilterOnlyQuery,
  isModuleDataRankingQuery,
  isOrdinalReference,
  isPicOrRequestorQuery,
  isProjectCountQuery,
  isStandaloneFinanceAggregateQuery,
  isUnsupportedDataQuery,
  detectFinanceMetrics,
  detectFinanceMode,
  shouldApplySessionFinanceFilters,
  needsScopeClarification,
  refineRecoveryQuery,
  resolveActiveReference,
  resolveNavigation,
  resolveSessionContext,
  topicAllowedTools,
  topicLabel,
  topicToKnowledgeModules,
  buildActiveDatasetKey,
  attributeNeedsLiveLookup,
  type UnknownKind,
} from './ai-nlu';
import {
  appendFinanceConstraintTags,
  appendInheritedRankingMetricTag,
  buildConstrainedDomainQuery,
  extractConstraintsFromText,
  hasUsableConstraint,
} from './ai-constraints';
import { extractSlots } from './ai-slot-fill';
import {
  buildMetaReasoningAnswer,
  isMetaReasoningInquiry,
  isUnknownInformationInquiry,
  mapResponseStrategy,
} from './ai-strategy';
import {
  encodeSessionInTraces,
  extractSessionFromHistory,
  isContextDependentFollowUp,
  mergeConstraints,
  normalizeSessionState,
  sessionTopicHint,
  type ActiveIntent,
  type ConversationSessionState,
  type ResponseStrategy,
  type RetrievalStrategy,
} from './ai-session';

export type ChatCitation = {
  title: string;
  module: string;
  sourceUri: string | null;
  chunkId: string;
  score: number;
};

export type ChatResponse = {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: ChatCitation[];
  toolTraces: ToolTrace[];
  grounded: boolean;
  refusal: boolean;
  ollamaUsed: boolean;
  intent: string;
  sticker?: string | null;
  proposedAction?: { action: string; label: string; href: string } | null;
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: AiKnowledgeService,
    private readonly ollama: AiOllamaService,
    private readonly tools: AiToolsService,
  ) {}

  async chat(
    user: AuthUser,
    message: string,
    conversationId?: string,
  ): Promise<ChatResponse> {
    const started = Date.now();
    const text = message.trim();

    let conversation = conversationId
      ? await this.prisma.aiConversation.findFirst({
          where: { id: conversationId, userId: user.userId },
        })
      : null;

    if (conversationId && !conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (!conversation) {
      conversation = await this.prisma.aiConversation.create({
        data: {
          userId: user.userId,
          title: text.slice(0, 80),
        },
      });
    }

    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: text,
      },
    });

    const history = (
      await this.prisma.aiMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: 16,
        select: { role: true, content: true, toolTraces: true },
      })
    ).slice(1);

    const priorUsers = history
      .filter((h) => h.role === 'user')
      .map((h) => h.content);
    const lastAssistant =
      history.find((h) => h.role === 'assistant')?.content ?? null;

    // P0: prefer first-class DB sessionState, fallback to toolTraces._session
    const dbSession = normalizeSessionState(
      ((conversation as unknown as { sessionState?: ConversationSessionState | null })
        .sessionState ?? null),
    );
    const historySession = extractSessionFromHistory(history);
    let session =
      dbSession.activeTopic ||
      dbSession.lastDataQuery ||
      dbSession.activeReference ||
      dbSession.activeDataset ||
      dbSession.activeObject
        ? dbSession
        : historySession;

    // P0/P3: extract + merge constraints (optional LLM slot fill)
    const slotResult = await extractSlots(text, this.ollama);
    const incomingConstraints =
      slotResult.constraints || extractConstraintsFromText(text);
    if (isStandaloneFinanceAggregateQuery(text)) {
      // PAI-FNC-001/002: new aggregate/status/metric resets leftover SITE/ACTIVE
      session = {
        ...session,
        constraints: {
          ...incomingConstraints,
          extra: [...(incomingConstraints.extra || [])],
        },
        activeObject: hasConversationalReference(text)
          ? session.activeObject
          : null,
      };
    } else if (hasUsableConstraint(incomingConstraints)) {
      session = {
        ...session,
        constraints: mergeConstraints(session.constraints, incomingConstraints),
      };
    }
    const sessionCtx = resolveSessionContext({
      message: text,
      priorUsers,
      lastAssistant,
      persistedTopic: session.activeTopic,
      persistedObject: session.activeObject,
    });

    let effectiveText = sessionCtx.effectiveText;
    if (sessionCtx.topicSwitched && sessionCtx.activeTopic) {
      session = {
        ...session,
        activeTopic: sessionCtx.activeTopic,
        activeObject: null,
        activeReference: null,
        activeDataset: null,
        activeDatasetAnswer: null,
        activeAttribute: null,
        correctionApplied: false,
        pendingRecovery: false,
      };
    } else if (sessionCtx.activeTopic) {
      session = {
        ...session,
        activeTopic: sessionCtx.activeTopic,
        activeObject: sessionCtx.activeObject || session.activeObject,
      };
    }

    const rawIntent = classifyPaIntent(text);
    let expandedIntent = classifyPaIntent(effectiveText);
    const conversational = new Set([
      'greeting',
      'capability',
      'clarify',
      'correction',
      'recovery',
      'meta',
      'off_topic',
    ]);
    let intent = conversational.has(rawIntent) ? rawIntent : expandedIntent;

    // PAI-FNC-001/005 V11: SITE/SEGMENT filter-set stays data inside Finance
    if (
      session.activeTopic === 'finance' &&
      (isFinanceContextFilterQuery(text) || isFinanceFilterOnlyQuery(text)) &&
      (intent === 'faq' || intent === 'howto')
    ) {
      intent = 'data';
    }

    // PAI-CSM-002: Conversation State follow-ups are always data — never Guide
    const stateFollowUp =
      !!session.activeTopic &&
      !!(
        session.activeObject ||
        session.activeReference ||
        session.activeDataset ||
        session.activeDatasetAnswer ||
        lastAssistant
      ) &&
      isConversationStateFollowUp(text);
    if (stateFollowUp) {
      intent = 'data';
    }

    // PAI-RSN-002: preserve Active Intent — ranking/data inside locked module
    if (
      session.activeTopic &&
      (isModuleDataRankingQuery(text) ||
        ((session.activeIntent === 'data' ||
          session.activeIntent === 'analytics') &&
          hasConversationalReference(text)))
    ) {
      intent = isModuleDataRankingQuery(text) ? 'analytics' : 'data';
    }

    const requestedAttr = detectRequestedAttribute(text);
    const explicitCode = extractExplicitEntityCode(text);

    // PAI-CSM-002: resolve Active Reference / Attribute from locked dataset —
    // do NOT re-run full ranking/list retrieval.
    let referenceDetail: string | null = null;
    let liveObjectLookup: string | null = null;
    if (stateFollowUp || explicitCode) {
      const snapshot = session.activeDatasetAnswer || lastAssistant;
      const resolved = resolveActiveReference({
        text: explicitCode
          ? `Yang tadi ${requestedAttr || ''}`.trim()
          : text,
        activeReference: session.activeReference,
        activeObject: explicitCode || session.activeObject,
        lastAssistant,
        datasetAnswer: snapshot,
      });

      if (explicitCode) {
        session = {
          ...session,
          activeObject: explicitCode,
          activeReference: explicitCode,
          activeAttribute: requestedAttr,
        };
        // Targeted single-project fetch — keep Active Dataset identity
        liveObjectLookup = requestedAttr
          ? `Detail ${requestedAttr.replace(/_/g, ' ')} project ${explicitCode}`
          : `Detail budget project ${explicitCode}`;
      } else if (resolved) {
        const needsLive = attributeNeedsLiveLookup(requestedAttr, resolved);
        if (needsLive && resolved.code) {
          liveObjectLookup = `Detail ${
            requestedAttr ? requestedAttr.replace(/_/g, ' ') : 'budget'
          } project ${resolved.code}`;
          session = {
            ...session,
            activeObject: resolved.label,
            activeReference: resolved.detailLine,
            activeAttribute: requestedAttr,
          };
        } else {
          referenceDetail = buildActiveReferenceDetailAnswer({
            text,
            activeReference: session.activeReference || session.activeObject,
            activeObject: session.activeObject,
            lastAssistant,
            datasetAnswer: snapshot,
            activeTopic: session.activeTopic,
            activeAttribute: requestedAttr,
          });
          if (referenceDetail) {
            session = {
              ...session,
              activeObject: resolved.label,
              activeReference: resolved.detailLine,
              activeAttribute: requestedAttr,
            };
          } else if (resolved.code) {
            liveObjectLookup = `Detail budget project ${resolved.code}`;
            session = {
              ...session,
              activeObject: resolved.label,
              activeReference: resolved.detailLine,
              activeAttribute: requestedAttr,
            };
          }
        }
      }
    }

    // BHV-003 / RSN-002: "yang tadi" → replay last data query ONLY when we
    // cannot resolve from Conversation State (preserve Active Dataset).
    if (
      !referenceDetail &&
      !liveObjectLookup &&
      (hasConversationalReference(text) || isContextDependentFollowUp(text)) &&
      session.activeTopic &&
      !isOrdinalReference(text) &&
      !isAttributeFollowUp(text) &&
      !isFinanceFilterOrAggregateQuery(text) &&
      // PAI-FNC-004: "Top 5 budget terbesar" must not replay prior realisasi ranking
      !isModuleDataRankingQuery(text) &&
      // PAI-FNC-001/002: standalone metric/count must not replay prior Summary
      !isProjectCountQuery(text) &&
      detectFinanceMetrics(text).length === 0
    ) {
      if (intent === 'faq' || intent === 'howto' || intent === 'navigation') {
        intent =
          session.activeIntent === 'analytics'
            ? 'analytics'
            : session.activeIntent === 'howto'
              ? 'howto'
              : 'data';
      }
      const lockedReplay =
        buildConstrainedDomainQuery(
          session.activeTopic,
          session.constraints,
          session.lastDataQuery,
        ) || session.lastDataQuery;
      if (lockedReplay) {
        effectiveText = `${lockedReplay}\n(konteks referensi: ${text})`;
      } else if (
        session.activeTopic === 'finance' &&
        !/budget|berapa|jumlah|project|material|jasa|realisasi|sisa|over|active|closed|archived/i.test(
          effectiveText,
        )
      ) {
        // PAI-FNC-001: bare follow-ups with Active Object keep object scope;
        // without object, do not force Total Budget summary for metric words
        // (handled by detectFinanceMetric on the original text).
        effectiveText = session.activeObject
          ? `Total budget project ${session.activeObject} berapa?\n(konteks: ${text})`
          : effectiveText;
      } else if (session.activeTopic === 'stock') {
        effectiveText = `Barang yang paling sedikit di stok\n(konteks referensi: ${text})`;
        intent = 'analytics';
      }
    }

    if (liveObjectLookup) {
      effectiveText = liveObjectLookup;
      intent = 'data';
    }

    // BHV-001/005: after correction/recovery, keep lane until explicit topic switch
    if (
      (session.correctionApplied || session.pendingRecovery) &&
      !sessionCtx.topicSwitched &&
      !conversational.has(rawIntent) &&
      (intent === 'faq' || intent === 'howto')
    ) {
      intent = 'data';
    }

    const topicHint =
      sessionTopicHint(session) ||
      (sessionCtx.activeTopic ? topicLabel(sessionCtx.activeTopic) : null);

    let nextState: ConversationSessionState = { ...session };

    const reply = async (
      answer: string,
      opts: Partial<{
        intent: string;
        sticker: string;
        refusal: boolean;
        grounded: boolean;
        toolTraces: ToolTrace[];
        citations: ChatCitation[];
        proposedAction: ChatResponse['proposedAction'];
        ollamaUsed: boolean;
        strategy: RetrievalStrategy;
        responseStrategy: ResponseStrategy;
        failureKind: UnknownKind | null;
        activeIntent?: ActiveIntent;
        reasoningNote?: string | null;
        dataQuery?: string | null;
        patch: Partial<ConversationSessionState>;
      }> = {},
    ) => {
      const entity =
        opts.patch?.activeObject !== undefined
          ? opts.patch.activeObject
          : extractEntityFromAnswer(answer) || nextState.activeObject;
      const refFromAnswer = extractActiveReferenceFromAnswer(answer);
      const isRankedList = /^\s*\d+\.\s+/m.test(answer) && (answer.match(/^\s*\d+\.\s+/gm) || []).length >= 2;
      const responseStrategy =
        opts.responseStrategy ??
        mapResponseStrategy(opts.intent ?? intent, opts.strategy, opts.refusal);
      const state: ConversationSessionState = {
        ...nextState,
        ...opts.patch,
        activeTopic: opts.patch?.activeTopic ?? nextState.activeTopic,
        activeObject: entity,
        activeReference:
          opts.patch?.activeReference !== undefined
            ? opts.patch.activeReference
            : (refFromAnswer?.detailLine ??
              nextState.activeReference ??
              entity),
        activeDataset:
          opts.patch?.activeDataset !== undefined
            ? opts.patch.activeDataset
            : nextState.activeDataset,
        activeDatasetAnswer:
          opts.patch?.activeDatasetAnswer !== undefined
            ? opts.patch.activeDatasetAnswer
            : isRankedList
              ? answer
              : nextState.activeDatasetAnswer,
        activeAttribute:
          opts.patch?.activeAttribute !== undefined
            ? opts.patch.activeAttribute
            : nextState.activeAttribute,
        activeIntent:
          opts.activeIntent ??
          opts.patch?.activeIntent ??
          nextState.activeIntent,
        constraints:
          opts.patch?.constraints ?? nextState.constraints,
        lastDataQuery:
          opts.dataQuery !== undefined
            ? opts.dataQuery
            : (opts.patch?.lastDataQuery ?? nextState.lastDataQuery),
        lastStrategy: opts.strategy ?? nextState.lastStrategy,
        lastResponseStrategy: responseStrategy,
        lastFailureKind:
          opts.failureKind !== undefined
            ? opts.failureKind
            : nextState.lastFailureKind,
        lastAnswerFp: answerFingerprint(answer),
        lastReasoningNote:
          opts.reasoningNote !== undefined
            ? opts.reasoningNote
            : (opts.patch?.lastReasoningNote ?? nextState.lastReasoningNote),
      };
      const traces = encodeSessionInTraces(
        (opts.toolTraces ?? []).filter((t) => t.name !== '_session'),
        state,
      ) as ToolTrace[];

      return this.persistAssistant({
        conversationId: conversation!.id,
        userId: user.userId,
        answer: this.ensureNotIdentical(answer, lastAssistant),
        citations: opts.citations ?? [],
        toolTraces: traces,
        grounded: opts.grounded ?? true,
        refusal: opts.refusal ?? false,
        ollamaUsed: opts.ollamaUsed ?? false,
        intent: opts.intent ?? intent,
        responseStrategy,
        failureKind: opts.failureKind ?? null,
        sessionState: state,
        metadata: {
          activeTopic: state.activeTopic,
          constraints: state.constraints,
          slotFillLlm: slotResult.usedLlm,
        },
        sticker:
          opts.sticker ??
          this.pickSticker({
            text: effectiveText,
            intent: opts.intent ?? intent,
            toolTraces: opts.toolTraces ?? [],
            refusal: opts.refusal ?? false,
            answer,
          }),
        proposedAction: opts.proposedAction ?? null,
        started,
      });
    };

    if (intent === 'off_topic') {
      return reply(
        'Maaf ya, aku PAI — cuma bisa bantu seputar PermaTrax (modul, data, approval, budget, dll). Tanya yang terkait app aja 🙏',
        { refusal: true, sticker: '🙅‍♂️', strategy: 'none' },
      );
    }

    if (intent === 'greeting') {
      return reply(
        'Halo! Aku PAI, asisten PermaTrax. Tanya aja soal modul, data, approval, budget, stok, atau cara pakai fitur ✨',
        { sticker: '👋', strategy: 'none' },
      );
    }

    // PAI-RSN-002: explicit module declaration / switch — ack & lock domain
    const moduleSwitch = isExplicitModuleSwitch(text);
    if (moduleSwitch) {
      return reply(buildModuleAck(moduleSwitch), {
        sticker: '📌',
        intent: 'clarify',
        strategy: 'clarify',
        responseStrategy: 'module_ack',
        patch: {
          activeTopic: moduleSwitch,
          activeObject: null,
          activeReference: null,
          activeDataset: null,
          activeDatasetAnswer: null,
          activeAttribute: null,
          constraints: {
            status: null,
            hierarchy: null,
            ranking: null,
            ownerName: null,
            projectNeedle: null,
            extra: [],
          },
          correctionApplied: false,
          pendingRecovery: false,
          lastFailureKind: null,
        },
      });
    }

    // PAI-CSM-002 / RSN-002: answer from Active Conversation State (no re-list)
    if (referenceDetail) {
      const resolved = resolveActiveReference({
        text,
        activeReference: session.activeReference,
        activeObject: session.activeObject,
        lastAssistant,
        datasetAnswer: session.activeDatasetAnswer || lastAssistant,
      });
      return reply(referenceDetail, {
        sticker: '🔎',
        intent: 'data',
        strategy: 'none',
        responseStrategy: 'operational_data',
        activeIntent: session.activeIntent === 'analytics' ? 'analytics' : 'data',
        toolTraces: [],
        reasoningNote:
          'Resolved Active Object / Attribute from Conversation State (no dataset re-retrieval).',
        patch: {
          activeObject: resolved?.label ?? session.activeObject,
          activeReference: resolved?.detailLine ?? session.activeReference,
          activeAttribute: requestedAttr,
          // Preserve locked dataset
          activeDataset: session.activeDataset,
          activeDatasetAnswer: session.activeDatasetAnswer || lastAssistant,
        },
      });
    }

    // PAI P1: PIC / requestor — live tools (not unsupported refuse)
    if (isPicOrRequestorQuery(text) && !isUnsupportedDataQuery(text)) {
      const picTools = this.tools.detectToolIntent(text);
      const names =
        picTools.length > 0
          ? picTools
          : ['lookup_project_pic'];
      const toolTraces = await this.tools.runTools(names, user, text);
      const ok = toolTraces.filter((t) => t.ok && t.summary);
      if (ok.length) {
        return reply(ok.map((t) => t.summary).join('\n\n'), {
          intent: 'data',
          sticker: '👤',
          toolTraces,
          strategy: 'search',
          responseStrategy: 'operational_data',
          activeIntent: 'data',
          dataQuery: text,
          reasoningNote: `Live lookup: ${names.join(', ')}`,
          patch: {
            activeTopic: session.activeTopic || sessionCtx.activeTopic,
          },
        });
      }
    }

    // Truly unsupported PII fields — never dump finance summary / FAQ
    if (isUnsupportedDataQuery(text)) {
      return reply(buildUnsupportedDataAnswer(text), {
        refusal: true,
        grounded: true,
        sticker: '🤔',
        intent: 'data',
        strategy: 'none',
        responseStrategy: 'refusal',
        failureKind: 'no_data',
        activeIntent: 'data',
        patch: {
          activeTopic: session.activeTopic || sessionCtx.activeTopic,
        },
      });
    }

    // Meta-reasoning / unknown-info — no ops re-fetch, no recovery
    if (
      intent === 'meta' ||
      isMetaReasoningInquiry(text) ||
      isUnknownInformationInquiry(text)
    ) {
      const unknown = isUnknownInformationInquiry(text);
      return reply(
        buildMetaReasoningAnswer({
          text,
          lastReasoningNote: session.lastReasoningNote,
          lastDataQuery: session.lastDataQuery,
          activeTopic: session.activeTopic
            ? topicLabel(session.activeTopic)
            : null,
        }),
        {
          sticker: '🧠',
          intent: 'meta',
          strategy: 'none',
          responseStrategy: unknown ? 'unknown_information' : 'meta_reasoning',
          activeIntent: 'meta',
          toolTraces: [],
        },
      );
    }

    // PAI P0/P1: recovery refine — merge constraints across modules, don't re-ask
    if (
      session.pendingRecovery &&
      !conversational.has(rawIntent) &&
      rawIntent !== 'recovery'
    ) {
      const topic = session.activeTopic || 'finance';
      const merged = mergeConstraints(
        session.constraints,
        extractConstraintsFromText(text),
      );
      const refined =
        refineRecoveryQuery(text, topic, session.lastDataQuery, {
          lastAssistant,
          activeIntent: session.activeIntent,
        }) ||
        buildConstrainedDomainQuery(topic, merged, session.lastDataQuery);
      if (refined) {
        const toolName =
          topic === 'stock'
            ? 'search_stock'
            : topic === 'cash'
              ? /pending|approval/i.test(refined)
                ? 'pending_fund_approvals'
                : 'last_fund_disbursement'
              : topic === 'visit'
                ? 'my_visit_requests'
                : topic === 'procurement'
                  ? 'my_purchase_requests'
                  : 'finance_analytics';
        const broader = /\[BROADER_RETRY\]/i.test(refined);
        const toolTraces = await this.tools.runTools(
          [toolName],
          user,
          refined,
        );
        const ok = toolTraces.filter((t) => t.ok && t.summary);
        if (ok.length) {
          return reply(
            `Baik — saya perbarui pemahaman dari koreksi Anda dan ambil data sesuai filter yang Anda maksud.\n\n${ok.map((t) => t.summary).join('\n\n')}`,
            {
              intent: 'data',
              sticker: topic === 'stock' ? '📦' : '💰',
              toolTraces,
              strategy: broader ? 'broader' : 'summary',
              responseStrategy: 'operational_data',
              activeIntent:
                merged.ranking || session.activeIntent === 'analytics'
                  ? 'analytics'
                  : 'data',
              dataQuery: refined,
              reasoningNote: `Recovery constraint merge on ${topic} → ${refined}`,
              patch: {
                pendingRecovery: false,
                correctionApplied: false,
                activeTopic: topic,
                constraints: merged,
                activeObject: extractEntityFromAnswer(ok[0].summary),
                activeReference:
                  extractActiveReferenceFromAnswer(ok[0].summary)
                    ?.detailLine ?? null,
                activeDataset: buildActiveDatasetKey({
                  topic,
                  ranking: merged.ranking,
                  hierarchy: merged.hierarchy,
                  status: merged.status,
                  query: refined,
                }),
                activeDatasetAnswer: ok[0].summary,
              },
            },
          );
        }
      }
    }

    if (intent === 'capability') {
      return reply(buildCapabilityAnswer(text), {
        sticker: '🤝',
        intent: 'capability',
        toolTraces: [],
        strategy: 'capability',
      });
    }

    if (sessionCtx.needsTopicClarify && sessionCtx.clarifyPrompt) {
      return reply(sessionCtx.clarifyPrompt, {
        sticker: '❓',
        intent: 'clarify',
        strategy: 'clarify',
        activeIntent: 'clarify',
      });
    }

    // Skip ambiguous clarify while recovering — user is refining intent (RSN-003 V4)
    if (intent === 'clarify' && !session.pendingRecovery) {
      return reply(buildClarificationPrompt(text), {
        sticker: '❓',
        intent: 'clarify',
        strategy: 'clarify',
        activeIntent: 'clarify',
      });
    }

    if (needsScopeClarification(text) || needsScopeClarification(effectiveText)) {
      return reply(buildScopeClarificationPrompt(), {
        sticker: '❓',
        intent: 'clarify',
        strategy: 'clarify',
        patch: { pendingRecovery: true, activeTopic: 'finance' },
      });
    }

    // Recovery: if message already carries constraints, merge & execute immediately
    if (intent === 'recovery') {
      const locked =
        nextState.activeTopic || sessionCtx.activeTopic || 'finance';
      const merged = mergeConstraints(
        nextState.constraints,
        extractConstraintsFromText(text),
      );
      nextState = {
        ...nextState,
        pendingRecovery: true,
        correctionApplied: true,
        activeTopic: locked,
        constraints: merged,
      };

      // Only inline-execute when THIS utterance carries refine language
      // (SITE/ACTIVE/maksud…). Bare "Bukan itu" must stay as recovery ask.
      const utteranceConstraints = extractConstraintsFromText(text);
      const utteranceHasRefine =
        !!refineRecoveryQuery(text, locked, session.lastDataQuery, {
          lastAssistant,
          activeIntent: session.activeIntent,
        }) ||
        (/(maksud|berdasarkan|aktif|active|site|segment|standalone|seluruh|semua)/i.test(
          text,
        ) &&
          hasUsableConstraint(utteranceConstraints));

      const inlineRefined = utteranceHasRefine
        ? refineRecoveryQuery(text, locked, session.lastDataQuery, {
            lastAssistant,
            activeIntent: session.activeIntent,
          }) ||
          buildConstrainedDomainQuery(locked, merged, session.lastDataQuery)
        : null;

      if (inlineRefined) {
        const toolName =
          locked === 'stock'
            ? 'search_stock'
            : locked === 'cash'
              ? /pending|approval/i.test(inlineRefined)
                ? 'pending_fund_approvals'
                : 'last_fund_disbursement'
              : locked === 'visit'
                ? 'my_visit_requests'
                : locked === 'procurement'
                  ? 'my_purchase_requests'
                  : 'finance_analytics';
        const broader = /\[BROADER_RETRY\]/i.test(inlineRefined);
        const toolTraces = await this.tools.runTools(
          [toolName],
          user,
          inlineRefined,
        );
        const ok = toolTraces.filter((t) => t.ok && t.summary);
        if (ok.length) {
          return reply(
            `Baik — saya perbarui pemahaman dari koreksi Anda dan ambil data sesuai filter yang Anda maksud.\n\n${ok.map((t) => t.summary).join('\n\n')}`,
            {
              intent: 'data',
              sticker: locked === 'stock' ? '📦' : '💰',
              toolTraces,
              strategy: broader ? 'broader' : 'summary',
              responseStrategy: 'operational_data',
              activeIntent: /top\s*10|terbesar|terkecil|paling/i.test(
                inlineRefined,
              )
                ? 'analytics'
                : 'data',
              dataQuery: inlineRefined,
              reasoningNote: `Inline recovery+constraint merge on ${locked} → ${inlineRefined}`,
              patch: {
                pendingRecovery: false,
                correctionApplied: false,
                activeTopic: locked,
                constraints: merged,
                activeObject: extractEntityFromAnswer(ok[0].summary),
                activeReference:
                  extractActiveReferenceFromAnswer(ok[0].summary)
                    ?.detailLine ?? null,
              },
            },
          );
        }
      }

      return reply(buildRecoveryAnswer(topicLabel(locked)), {
        sticker: '🙏',
        intent: 'recovery',
        strategy: 'recovery',
        responseStrategy: 'recovery',
        patch: nextState,
      });
    }

    // Soft correction like "Kayaknya datanya kurang sesuai" while domain locked
    // → recovery in-domain (RSN-001), not Cash Op / Visit KB
    if (
      intent === 'correction' &&
      nextState.activeTopic &&
      /(kurang sesuai|kayaknya|sepertinya|datanya)/i.test(text) &&
      !/(lihat|banyak|tersedia di|ada banyak)/i.test(text)
    ) {
      nextState = {
        ...nextState,
        pendingRecovery: true,
        correctionApplied: true,
      };
      return reply(buildRecoveryAnswer(topicLabel(nextState.activeTopic)), {
        sticker: '🙏',
        intent: 'recovery',
        strategy: 'recovery',
        patch: nextState,
      });
    }

    // --- BHV-001 correction: broader retrieval, lock topic ---
    if (intent === 'correction') {
      nextState = {
        ...nextState,
        correctionApplied: true,
        pendingRecovery: false,
        activeTopic: nextState.activeTopic || 'finance',
      };

      const shouldRetryFinance =
        nextState.activeTopic === 'finance' ||
        /finance|project|proyek|budget|anggaran/i.test(
          `${text} ${priorUsers[0] || ''} ${lastAssistant || ''} ${topicHint || ''}`,
        );

      if (shouldRetryFinance) {
        const toolTraces = await this.tools.runTools(
          ['finance_analytics'],
          user,
          'Finance Project ringkasan [BROADER_RETRY] [USER_CORRECTION]',
        );
        const ok = toolTraces.filter((t) => t.ok && t.summary);
        if (ok.length > 0) {
          const newBody = ok.map((t) => t.summary).join('\n\n');
          const prevFp = session.lastAnswerFp || answerFingerprint(lastAssistant || '');
          const newFp = answerFingerprint(newBody);
          const sameCore =
            prevFp.length > 40 &&
            newFp.length > 40 &&
            (prevFp.includes(newFp.slice(0, 60)) ||
              newFp.includes(prevFp.slice(0, 60)) ||
              prevFp === newFp);

          const obj = extractEntityFromAnswer(newBody);
          nextState = {
            ...nextState,
            activeObject: obj || nextState.activeObject,
            lastStrategy: 'broader',
          };

          if (sameCore) {
            return reply(`${buildCorrectionSameResult()}\n\n${newBody}`, {
              intent: 'correction',
              sticker: '💬',
              toolTraces,
              strategy: 'broader',
              patch: nextState,
            });
          }
          return reply(`${buildCorrectionAckWithRetry()}\n\n${newBody}`, {
            intent: 'correction',
            sticker: '💰',
            toolTraces,
            strategy: 'broader',
            patch: nextState,
          });
        }
        return reply(buildRecoveryFailedAnswer(), {
          intent: 'correction',
          sticker: '💬',
          toolTraces,
          strategy: 'broader',
          failureKind: 'retrieval_failed',
          patch: nextState,
        });
      }

      return reply(
        buildCorrectionRecoveryAnswer({ text, lastAssistant, topicHint }),
        {
          sticker: '💬',
          intent: 'correction',
          strategy: 'recovery',
          patch: nextState,
        },
      );
    }

    // User answered recovery scope / hierarchy choice → execute within locked topic
    if (
      session.pendingRecovery &&
      session.activeTopic === 'finance' &&
      /(active|aktif|seluruh|semua|non.?arsip|broader|luas|berdasarkan\s+site|\bsite\b|\bsegment\b)/i.test(
        text,
      ) &&
      !conversational.has(rawIntent)
    ) {
      const refined =
        refineRecoveryQuery(text, 'finance', session.lastDataQuery, {
          lastAssistant,
          activeIntent: session.activeIntent,
        }) ||
        (/(seluruh|semua|non.?arsip|closed|luas)/i.test(text)
          ? 'Finance Project ringkasan [BROADER_RETRY]'
          : 'berapa jumlah finance project tersedia total aktif [SCOPE_ACTIVE]');
      const broader = /\[BROADER_RETRY\]/i.test(refined);
      const toolTraces = await this.tools.runTools(
        ['finance_analytics'],
        user,
        refined,
      );
      const ok = toolTraces.filter((t) => t.ok && t.summary);
      if (ok.length) {
        return reply(
          `Baik — saya sesuaikan dengan pilihan Anda.\n\n${ok.map((t) => t.summary).join('\n\n')}`,
          {
            intent: 'data',
            sticker: '💰',
            toolTraces,
            strategy: broader ? 'broader' : 'summary',
            activeIntent: /top\s*10|terbesar|terkecil/i.test(refined)
              ? 'analytics'
              : 'data',
            dataQuery: refined,
            reasoningNote: `Recovery constraint merge → ${refined}`,
            patch: {
              pendingRecovery: false,
              correctionApplied: false,
              activeTopic: 'finance',
              activeObject: extractEntityFromAnswer(ok[0].summary),
              activeReference:
                extractActiveReferenceFromAnswer(ok[0].summary)?.detailLine ??
                null,
            },
          },
        );
      }
    }

    if (intent === 'navigation') {
      const nav = resolveNavigation(effectiveText);
      if (nav) {
        return reply(nav.answer, {
          sticker: nav.sticker,
          strategy: 'howto',
          proposedAction: nav.href
            ? { action: 'open_nav', label: 'Buka menu', href: nav.href }
            : null,
        });
      }
    }

    if (intent === 'howto') {
      // RSN-002 / CSM-002: ranking + Conversation State follow-ups never Guide
      if (
        isModuleDataRankingQuery(text) ||
        isModuleDataRankingQuery(effectiveText) ||
        stateFollowUp
      ) {
        intent = 'analytics';
      } else if (
        session.correctionApplied ||
        session.pendingRecovery
      ) {
        // During locked recovery — don't jump to unrelated SOP
        return reply(buildRecoveryAnswer(topicHint || 'Finance Project'), {
          sticker: '🙏',
          intent: 'recovery',
          strategy: 'recovery',
          patch: { pendingRecovery: true },
        });
      }
    }

    if (intent === 'howto') {
      const domainModules = session.activeTopic
        ? topicToKnowledgeModules(session.activeTopic)
        : undefined;
      const chunks = await this.knowledge.retrieve(effectiveText, user.role, {
        topK: 4,
        categories: ['user-guide', 'sop', 'navigation'],
        modules: domainModules?.length ? domainModules : undefined,
      });
      const action = this.tools.detectActionProposal(effectiveText);
      const proposedAction = action
        ? { ...action, href: this.actionHref(action.action) }
        : null;

      if (chunks.length === 0 && !proposedAction) {
        // Domain-locked miss → knowledge limitation in THIS domain (not Guide dump)
        return reply(
          session.activeTopic
            ? [
                `Maaf, panduan langkah untuk ${topicLabel(session.activeTopic)} belum tersedia dalam knowledge domain aktif.`,
                'Coba sebutkan lebih spesifik, atau buka menu modul tersebut di aplikasi.',
              ].join('\n')
            : buildUnknownAnswer('no_knowledge'),
          {
            refusal: true,
            grounded: false,
            sticker: '🤔',
            strategy: 'howto',
            failureKind: 'no_knowledge',
          },
        );
      }

      const { answer, ollamaUsed } = await this.composeAnswer({
        user,
        text: effectiveText,
        chunks,
        toolTraces: [],
        proposedAction,
      });

      return reply(answer, {
        citations: chunks.map((c) => ({
          title: c.title,
          module: c.module,
          sourceUri: c.sourceUri,
          chunkId: c.chunkId,
          score: c.score,
        })),
        ollamaUsed,
        proposedAction,
        strategy: 'howto',
      });
    }

    const useTools =
      intent === 'data' || intent === 'analytics' || intent === 'comparison';

    let toolNames = useTools
      ? this.tools.detectToolIntent(effectiveText)
      : [];

    // PAI-RSN-001/002: domain lock — drop tools outside active module
    const allowed = session.activeTopic
      ? topicAllowedTools(session.activeTopic)
      : null;
    if (allowed) {
      toolNames = toolNames.filter((n) => allowed.includes(n));
    }

    // Locked finance topic: always prefer finance analytics for data intents
    if (
      useTools &&
      session.activeTopic === 'finance' &&
      !toolNames.includes('finance_analytics') &&
      (/budget|project|proyek|berapa|jumlah|total|terbesar|terkecil|over|material|jasa|realisasi|sisa|active|closed|archived|site|segment/i.test(
        effectiveText,
      ) ||
        isFinanceFilterOrAggregateQuery(text) ||
        isFinanceFilterOrAggregateQuery(effectiveText))
    ) {
      toolNames.unshift('finance_analytics');
    }

    // Locked stock + ranking/data intent → search_stock (not howto KB)
    if (
      useTools &&
      session.activeTopic === 'stock' &&
      !toolNames.includes('search_stock') &&
      (intent === 'data' ||
        intent === 'analytics' ||
        isModuleDataRankingQuery(text) ||
        isModuleDataRankingQuery(effectiveText))
    ) {
      toolNames.unshift('search_stock');
    }

    // PAI-FNC-005: inherit SITE/ACTIVE on ranking follow-ups only.
    // PAI-FNC-001/002: standalone aggregates must not inherit a narrower dataset.
    let toolMessage = effectiveText;
    if (
      toolNames.includes('finance_analytics') &&
      hasUsableConstraint(session.constraints) &&
      shouldApplySessionFinanceFilters(text)
    ) {
      toolMessage = appendFinanceConstraintTags(
        effectiveText,
        session.constraints,
      );
      const mode = detectFinanceMode(text);
      if (mode === 'top_budget' || mode === 'smallest' || mode === 'ranking') {
        toolMessage = appendInheritedRankingMetricTag(
          toolMessage,
          session.constraints,
          text,
        );
      }
    }

    const toolTraces =
      toolNames.length > 0
        ? await this.tools.runTools(toolNames, user, toolMessage)
        : [];

    const hasUsefulTools = toolTraces.some(
      (t) =>
        t.ok &&
        t.summary &&
        !/tidak ditemukan|tidak ada finance project berstatus/i.test(t.summary),
    );
    const hasToolAttempt = toolTraces.some((t) => t.ok && t.summary);
    const wasSearchMode = detectFinanceMode(toolMessage) === 'search';

    // BHV-007: classify failure BEFORE any FAQ / overview dump
    if (useTools && hasToolAttempt && !hasUsefulTools) {
      const kind = classifyFailureFromTools(toolTraces);
      // PAI-FNC-003: empty business search must NOT become Finance Summary
      if (wasSearchMode && kind === 'retrieval_failed') {
        return reply(
          toolTraces.map((t) => t.summary).join('\n\n') ||
            'Project tidak ditemukan untuk kata kunci tersebut. Coba nama site, segment, client/PO, atau kode project.',
          {
            toolTraces,
            strategy: 'search',
            patch: {
              activeTopic: 'finance',
              lastFailureKind: 'retrieval_failed',
            },
          },
        );
      }
      // Broader retry once if search empty under finance topic (non-search modes)
      if (
        kind === 'retrieval_failed' &&
        !wasSearchMode &&
        (session.activeTopic === 'finance' ||
          /finance|project|proyek/i.test(effectiveText))
      ) {
        const retry = await this.tools.runTools(
          ['finance_analytics'],
          user,
          'Finance Project ringkasan [BROADER_RETRY]',
        );
        if (
          retry.some(
            (t) =>
              t.ok &&
              t.summary &&
              !/tidak ditemukan|tidak ada finance/i.test(t.summary),
          )
        ) {
          return reply(
            `Pencarian nama spesifik kosong — saya coba ringkasan lebih luas:\n\n${retry.map((t) => t.summary).join('\n\n')}`,
            {
              toolTraces: retry,
              strategy: 'broader',
              patch: {
                activeTopic: 'finance',
                activeObject: extractEntityFromAnswer(retry[0]?.summary),
                lastFailureKind: null,
              },
            },
          );
        }
      }
      return reply(buildUnknownAnswer(kind), {
        refusal: true,
        grounded: false,
        toolTraces,
        sticker: '🤔',
        strategy: 'search',
        failureKind: kind,
        patch: { activeTopic: session.activeTopic || 'finance' },
      });
    }

    if (useTools && toolTraces.length === 0) {
      if (
        session.activeTopic === 'finance' ||
        /finance|budget|project|proyek/i.test(effectiveText)
      ) {
        const retry = await this.tools.runTools(
          ['finance_analytics'],
          user,
          'berapa jumlah finance project tersedia saat ini total aktif',
        );
        if (retry.some((t) => t.ok && t.summary)) {
          return reply(retry.map((t) => t.summary).join('\n\n'), {
            toolTraces: retry,
            strategy: 'summary',
            patch: {
              activeTopic: 'finance',
              activeObject: extractEntityFromAnswer(retry[0]?.summary),
            },
          });
        }
      }
      return reply(buildUnknownAnswer('unknown'), {
        refusal: true,
        grounded: false,
        sticker: '🤔',
        strategy: 'none',
        failureKind: 'unknown',
      });
    }

    let chunks: RetrievedChunk[] = [];
    // Never retrieve generic FAQ while finance topic is locked / data intent
    // PAI-RSN-001: hard-filter knowledge modules to active domain
    if (!hasUsefulTools && intent === 'faq' && !session.correctionApplied) {
      const domainModules = session.activeTopic
        ? topicToKnowledgeModules(session.activeTopic)
        : undefined;
      chunks = await this.knowledge.retrieve(effectiveText, user.role, {
        topK: 5,
        categories: ['faq', 'glossary', 'user-guide'],
        modules: domainModules?.length ? domainModules : undefined,
      });
      // BHV-007 / RSN-004: if only overview junk matched, prefer unknown
      if (
        chunks.length &&
        /overview|apa itu permatrax|kebijakan scope/i.test(chunks[0].title) &&
        !/apa itu permatrax|jelaskan permatrax/i.test(text)
      ) {
        return reply(buildUnknownAnswer('no_knowledge'), {
          refusal: true,
          grounded: false,
          failureKind: 'no_knowledge',
          strategy: 'none',
        });
      }
      // Cross-domain leak guard
      if (
        chunks.length &&
        domainModules?.length &&
        !domainModules.includes(chunks[0].module)
      ) {
        chunks = [];
      }
    }

    const action = this.tools.detectActionProposal(effectiveText);
    const proposedAction = action
      ? { ...action, href: this.actionHref(action.action) }
      : null;

    if (!hasUsefulTools && chunks.length === 0 && !proposedAction) {
      const kind: UnknownKind =
        intent === 'faq' ? 'no_knowledge' : 'unknown';
      return reply(buildUnknownAnswer(kind), {
        refusal: true,
        grounded: false,
        toolTraces,
        sticker: '🤔',
        failureKind: kind,
        strategy: 'none',
      });
    }

    const citations: ChatCitation[] = hasUsefulTools
      ? []
      : chunks.map((c) => ({
          title: c.title,
          module: c.module,
          sourceUri: c.sourceUri,
          chunkId: c.chunkId,
          score: c.score,
        }));

    // Tool said access denied — surface that, don't compose with FAQ
    const accessDenied = toolTraces.find((t) =>
      /belum punya akses|tidak memiliki akses|role kamu belum/i.test(t.summary),
    );
    if (accessDenied) {
      return reply(buildUnknownAnswer('no_access'), {
        refusal: true,
        grounded: true,
        toolTraces,
        failureKind: 'no_access',
        strategy: 'summary',
      });
    }

    const { answer, ollamaUsed } = await this.composeAnswer({
      user,
      text: effectiveText,
      chunks: hasUsefulTools ? [] : chunks,
      toolTraces: hasUsefulTools ? toolTraces : [],
      proposedAction,
    });

    const resolvedIntent: ActiveIntent =
      intent === 'analytics'
        ? 'analytics'
        : intent === 'navigation'
          ? 'navigation'
          : intent === 'comparison'
            ? 'analytics'
            : 'data';
    const reasoningNote = hasUsefulTools
      ? toolTraces
          .filter((t) => t.ok && t.name !== '_session')
          .map((t) => `tool ${t.name}`)
          .join(', ') +
        (session.activeTopic
          ? ` pada Active Module ${topicLabel(session.activeTopic)}`
          : '')
      : null;

    return reply(answer, {
      citations,
      toolTraces,
      ollamaUsed,
      proposedAction,
      strategy: hasUsefulTools ? 'summary' : 'howto',
      activeIntent: resolvedIntent,
      dataQuery: hasUsefulTools
        ? /(terbesar|terkecil|paling|top\s*\d*|ranking|stoknya|sedikit)/i.test(
            text,
          )
          ? text
          : effectiveText.split('\n')[0]
        : session.lastDataQuery,
      reasoningNote,
      patch: {
        activeTopic: session.activeTopic || sessionCtx.activeTopic,
        activeObject:
          liveObjectLookup || explicitCode
            ? session.activeObject || extractEntityFromAnswer(answer)
            : extractEntityFromAnswer(answer) || session.activeObject,
        activeReference:
          session.activeReference ||
          extractActiveReferenceFromAnswer(answer)?.detailLine ||
          null,
        activeAttribute: requestedAttr ?? session.activeAttribute,
        activeDataset:
          session.activeDataset ||
          buildActiveDatasetKey({
            topic: session.activeTopic || sessionCtx.activeTopic,
            ranking: session.constraints.ranking,
            hierarchy: session.constraints.hierarchy,
            status: session.constraints.status,
            query: hasUsefulTools
              ? (session.lastDataQuery || text)
              : null,
          }),
        activeDatasetAnswer: undefined, // let reply() auto-capture ranked lists
        correctionApplied: false,
        pendingRecovery: false,
        lastFailureKind: null,
      },
    });
  }

  private ensureNotIdentical(
    answer: string,
    lastAssistant: string | null,
  ): string {
    if (!lastAssistant) return answer;
    if (answer.trim() === lastAssistant.trim()) {
      return [
        answer,
        '',
        'Kalau hasilnya masih terasa sama, coba sebut nama/kode project atau filter lain (aktif / non-arsip) supaya aku sesuaikan pencariannya.',
      ].join('\n');
    }
    return answer;
  }

  async feedback(
    user: AuthUser,
    messageId: string,
    rating: number,
    comment?: string,
  ) {
    const msg = await this.prisma.aiMessage.findFirst({
      where: {
        id: messageId,
        conversation: { userId: user.userId },
      },
    });
    if (!msg) throw new NotFoundException('Message not found');
    return this.prisma.aiFeedback.upsert({
      where: { messageId },
      create: { messageId, rating, comment },
      update: { rating, comment },
    });
  }

  async health() {
    const ollama = await this.ollama.isAvailable();
    const articles = await this.prisma.aiKnowledgeArticle.count().catch(() => 0);
    return {
      ok: true,
      ollama,
      model: this.ollama.getModelName(),
      knowledgeArticles: articles,
      mode: ollama ? 'ollama+rag+tools' : 'rag+tools-fallback',
    };
  }

  private actionHref(action: string): string {
    switch (action) {
      case 'open_clean_list':
        return '/clean-list';
      case 'open_cash_operation':
        return '/cash-operation';
      case 'open_purchase_request':
        return '/purchase-requests';
      default:
        return '/guide';
    }
  }

  private async composeAnswer(input: {
    user: AuthUser;
    text: string;
    chunks: RetrievedChunk[];
    toolTraces: ToolTrace[];
    proposedAction: { action: string; label: string; href: string } | null;
  }): Promise<{ answer: string; ollamaUsed: boolean }> {
    const toolBlock = input.toolTraces
      .filter((t) => t.ok && t.name !== '_session')
      .map((t) => `- [${t.name}] ${t.summary}`)
      .join('\n');
    const knowledgeBlock = input.chunks
      .map((c, i) => `[${i + 1}] ${c.title} (${c.module})\n${c.content}`)
      .join('\n\n');

    const system = `Anda adalah asisten resmi aplikasi PermaTrax (PAI).
Aturan ketat:
- Hanya jawab tentang PermaTrax.
- Jangan mengarang. Jika fakta tidak ada di KONTEKS / DATA TOOL, katakan data tidak tersedia dengan alasan yang tepat.
- Jangan berpindah topik atau dump definisi umum PermaTrax bila user sedang membahas Finance/data.
- Jawab ringkas dalam Bahasa Indonesia.
- Role user: ${input.user.role}${input.user.fiberType ? ` / ${input.user.fiberType}` : ''}.`;

    const userPrompt = `Pertanyaan: ${input.text}

DATA TOOL (live):
${toolBlock || '(tidak ada)'}

KONTEKS KNOWLEDGE:
${knowledgeBlock || '(tidak ada)'}

${
  input.proposedAction
    ? `USULAN AKSI: ${input.proposedAction.label} → ${input.proposedAction.href}`
    : ''
}`;

    const llm = await this.ollama.chat(system, userPrompt);
    if (llm.used && llm.text) {
      return { answer: llm.text, ollamaUsed: true };
    }

    const okTools = input.toolTraces.filter(
      (t) => t.ok && t.summary && t.name !== '_session',
    );
    if (okTools.length > 0) {
      return {
        answer: okTools.map((t) => t.summary).join('\n\n'),
        ollamaUsed: false,
      };
    }

    const parts: string[] = [];
    if (input.chunks[0]) parts.push(input.chunks[0].content);
    if (input.proposedAction) {
      parts.push(
        `Aksi disarankan: ${input.proposedAction.label}. Buka ${input.proposedAction.href}`,
      );
    }
    if (parts.length === 0) {
      parts.push(buildUnknownAnswer('unknown'));
    }
    return { answer: parts.join('\n\n').trim(), ollamaUsed: false };
  }

  private pickSticker(input: {
    text: string;
    intent: string;
    toolTraces: ToolTrace[];
    refusal: boolean;
    answer: string;
  }): string {
    const m = input.text.toLowerCase();
    const tools = input.toolTraces.map((t) => t.name).join(' ');
    const ans = input.answer.toLowerCase();

    if (input.refusal) return '😅';
    if (input.intent === 'greeting') return '👋';
    if (input.intent === 'capability') return '🤝';
    if (input.intent === 'clarify') return '❓';
    if (input.intent === 'correction' || input.intent === 'recovery') return '💬';
    if (input.intent === 'navigation' || /dimana|di mana|letak/.test(m))
      return '📍';
    if (input.intent === 'howto') return '📘';
    if (/over\s*budget|overbudget/.test(m) || /over budget/.test(ans))
      return '🚨';
    if (/top\s*\d*|terbesar|ranking/.test(m)) return '🏆';
    if (
      tools.includes('finance_analytics') ||
      /budget|anggaran|duit|finance/.test(m)
    ) {
      return '💰';
    }
    if (
      tools.includes('last_fund_disbursement') ||
      /dana.*keluar|cair|pencairan/.test(m)
    ) {
      return '💸';
    }
    if (/stok|stock|barang/.test(m)) return '📦';
    if (/cluster|permit|pipeline|visit/.test(m)) return '🗺️';
    return '✨';
  }

  private async persistAssistant(args: {
    conversationId: string;
    userId: string;
    answer: string;
    citations: ChatCitation[];
    toolTraces: ToolTrace[];
    grounded: boolean;
    refusal: boolean;
    ollamaUsed: boolean;
    intent: string;
    responseStrategy?: ResponseStrategy;
    failureKind?: UnknownKind | null;
    sessionState?: ConversationSessionState;
    metadata?: Record<string, unknown>;
    sticker?: string | null;
    proposedAction: ChatResponse['proposedAction'];
    started: number;
  }): Promise<ChatResponse> {
    const msg = await this.prisma.aiMessage.create({
      data: {
        conversationId: args.conversationId,
        role: 'assistant',
        content: args.answer,
        citations: args.citations as unknown as Prisma.InputJsonValue,
        toolTraces: args.toolTraces as unknown as Prisma.InputJsonValue,
        grounded: args.grounded,
      },
    });

    await this.prisma.aiPromptLog
      .create({
        data: {
          userId: args.userId,
          conversationId: args.conversationId,
          messageId: msg.id,
          intent: args.intent,
          responseStrategy: args.responseStrategy ?? null,
          failureKind: args.failureKind ?? null,
          metadata: (args.metadata ??
            undefined) as unknown as Prisma.InputJsonValue,
          model: args.ollamaUsed ? this.ollama.getModelName() : 'extractive',
          latencyMs: Date.now() - args.started,
          ollamaUsed: args.ollamaUsed,
          refusal: args.refusal,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `prompt log failed: ${err instanceof Error ? err.message : err}`,
        ),
      );

    // P0: persist Conversation State on AiConversation
    await this.prisma.aiConversation
      .update({
        where: { id: args.conversationId },
        data: {
          updatedAt: new Date(),
          ...(args.sessionState
            ? {
                sessionState:
                  args.sessionState as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      })
      .catch(() => undefined);

    const publicTraces = args.toolTraces.filter((t) => t.name !== '_session');

    return {
      conversationId: args.conversationId,
      messageId: msg.id,
      answer: args.answer,
      citations: args.citations,
      toolTraces: publicTraces,
      grounded: args.grounded,
      refusal: args.refusal,
      ollamaUsed: args.ollamaUsed,
      intent: args.intent,
      sticker: args.sticker ?? null,
      proposedAction: args.proposedAction,
    };
  }
}
