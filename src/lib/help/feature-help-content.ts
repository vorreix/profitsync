export const FEATURE_HELP_IDS = ["wealth", "netProfit", "moneyFlow"] as const

export type FeatureHelpId = (typeof FEATURE_HELP_IDS)[number]

export type FeatureHelpContent = {
  titleKey: string
  bodyKey: string
  includesKeys?: string[]
  whyKey: string
  tipKey?: string
}

export const FEATURE_HELP_CONTENT: Record<FeatureHelpId, FeatureHelpContent> = {
  wealth: {
    titleKey: "featureHelp.wealth.title",
    bodyKey: "featureHelp.wealth.body",
    includesKeys: [
      "featureHelp.wealth.includes.cash",
      "featureHelp.wealth.includes.bank",
      "featureHelp.wealth.includes.active",
    ],
    whyKey: "featureHelp.wealth.why",
    tipKey: "featureHelp.wealth.tip",
  },
  netProfit: {
    titleKey: "featureHelp.netProfit.title",
    bodyKey: "featureHelp.netProfit.body",
    includesKeys: [
      "featureHelp.netProfit.includes.incoming",
      "featureHelp.netProfit.includes.outgoing",
      "featureHelp.netProfit.includes.filters",
    ],
    whyKey: "featureHelp.netProfit.why",
    tipKey: "featureHelp.netProfit.tip",
  },
  moneyFlow: {
    titleKey: "featureHelp.moneyFlow.title",
    bodyKey: "featureHelp.moneyFlow.body",
    includesKeys: [
      "featureHelp.moneyFlow.includes.incoming",
      "featureHelp.moneyFlow.includes.outgoing",
      "featureHelp.moneyFlow.includes.grouping",
    ],
    whyKey: "featureHelp.moneyFlow.why",
    tipKey: "featureHelp.moneyFlow.tip",
  },
}
