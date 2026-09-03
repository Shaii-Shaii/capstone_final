import {
  createImageEdit as createOpenAiImageEdit,
  createStructuredResponse as createOpenAiStructuredResponse,
  getDefaultOpenAiImageModel,
  getDefaultOpenAiModel,
} from './openai.ts';
import {
  createImageEdit as createOpenRouterImageEdit,
  createStructuredResponse as createOpenRouterStructuredResponse,
  getDefaultOpenRouterImageModel,
  getDefaultOpenRouterModel,
  isOpenRouterConfigured,
} from './openrouter.ts';

export const getAiGenerationProvider = () => (
  isOpenRouterConfigured() ? 'openrouter' : 'openai'
);

export const getDefaultAiModel = () => (
  isOpenRouterConfigured() ? getDefaultOpenRouterModel() : getDefaultOpenAiModel()
);

export const getDefaultAiImageModel = () => (
  isOpenRouterConfigured() ? getDefaultOpenRouterImageModel() : getDefaultOpenAiImageModel()
);

export const createStructuredResponse = async (options: Parameters<typeof createOpenAiStructuredResponse>[0]) => (
  isOpenRouterConfigured()
    ? await createOpenRouterStructuredResponse(options)
    : await createOpenAiStructuredResponse(options)
);

export const createImageEdit = async (options: Parameters<typeof createOpenAiImageEdit>[0]) => (
  isOpenRouterConfigured()
    ? await createOpenRouterImageEdit(options)
    : await createOpenAiImageEdit(options)
);
