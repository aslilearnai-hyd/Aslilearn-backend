/**
 * @typedef {object} PromptContext
 * @property {string} [slug]
 * @property {string} [toolTitle]
 * @property {string} [board]
 * @property {string} [classLabel]
 * @property {string} [gradeLevel]
 * @property {string} [subject]
 * @property {string} [topic]
 * @property {string} [subTopic]
 * @property {string} [subtopic]
 * @property {string} [bloomLevel]
 * @property {number} [questionCount]
 * @property {number} [cardCount]
 * @property {string} [duration]
 * @property {number} [attempt]
 * @property {string} [validationMessage]
 * @property {string[]} [missingSections]
 * @property {Record<string, unknown>} [extraParams]
 */

/**
 * @typedef {object} ToolPromptPack
 * @property {string} slug
 * @property {string} toolTitle
 * @property {(ctx?: PromptContext) => string} system
 * @property {(ctx?: PromptContext) => string} generation
 * @property {(ctx?: PromptContext) => string} rewrite
 * @property {(ctx?: PromptContext) => string} repair
 */

export {};
