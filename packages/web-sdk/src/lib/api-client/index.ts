import { sessionsMixin } from './sessions';
import { gitMixin } from './git';
import { configMixin } from './config';
import { filesMixin } from './files';
import { branchesMixin } from './branches';
import { goalsMixin } from './goals';
import { approvalMixin } from './approval';
import { ottorouterMixin } from './ottorouter';
import { authMixin } from './auth';
import { skillsMixin } from './skills';
import { recipesMixin } from './recipes';
import { usageMixin } from './usage';
import { dictationMixin } from './dictation';
import { secureInputMixin } from './secure-input';
import { pluginsMixin } from './plugins';

export { configureApiClient } from './utils';
export type {
	Goal,
	GoalStatus,
	GoalTask,
	GoalTaskStatus,
	Subagent,
	SubagentStatus,
} from './goals';
export type {
	CreateDictationSessionInput,
	CreateDictationSessionResponse,
	DictationModelInstallEvent,
	DictationModelInstallStatus,
	DictationModelState,
	DictationModelsResponse,
	DictationStatusResponse,
	InstallDictationModelInput,
	InstallDictationModelResponse,
	RemoveDictationModelResponse,
} from './dictation';
export type { Recipe } from './recipes';
export type {
	DiscoveredPlugin,
	EffectivePlugin,
	PluginCommand,
	PluginInstallInput,
	PluginManifest,
	PluginMutationInput,
	PluginMutationResponse,
	PluginProjectOptions,
	PluginRegistryEntry,
	PluginRegistryResponse,
	PluginsListResponse,
	PluginScope,
	PluginUpdateInput,
	PluginUpdateResponse,
} from './plugins';

class ApiClient {
	getSessions = sessionsMixin.getSessions;
	getSessionsPage = sessionsMixin.getSessionsPage;
	createSession = sessionsMixin.createSession;
	getSession = sessionsMixin.getSession;
	updateSession = sessionsMixin.updateSession;
	markSessionViewed = sessionsMixin.markSessionViewed;
	deleteSession = sessionsMixin.deleteSession;
	createHandoff = sessionsMixin.createHandoff;
	abortSession = sessionsMixin.abortSession;
	abortMessage = sessionsMixin.abortMessage;
	getQueueState = sessionsMixin.getQueueState;
	removeFromQueue = sessionsMixin.removeFromQueue;
	sendQueuedMessageNow = sessionsMixin.sendQueuedMessageNow;
	getMessages = sessionsMixin.getMessages;
	sendMessage = sessionsMixin.sendMessage;
	getStreamUrl = sessionsMixin.getStreamUrl;
	retryMessage = sessionsMixin.retryMessage;

	initGitRepo = gitMixin.initGitRepo;
	getGitStatus = gitMixin.getGitStatus;
	getGitDiff = gitMixin.getGitDiff;
	getGitDiffFullFile = gitMixin.getGitDiffFullFile;
	generateCommitMessage = gitMixin.generateCommitMessage;
	stageFiles = gitMixin.stageFiles;
	unstageFiles = gitMixin.unstageFiles;
	restoreFiles = gitMixin.restoreFiles;
	deleteFiles = gitMixin.deleteFiles;
	commitChanges = gitMixin.commitChanges;
	getGitBranch = gitMixin.getGitBranch;
	pushCommits = gitMixin.pushCommits;
	pullChanges = gitMixin.pullChanges;
	performRebaseAction = gitMixin.performRebaseAction;
	getRemotes = gitMixin.getRemotes;
	addRemote = gitMixin.addRemote;
	removeRemote = gitMixin.removeRemote;
	listGitBranches = gitMixin.listGitBranches;
	checkoutBranch = gitMixin.checkoutBranch;
	createGitBranch = gitMixin.createGitBranch;

	getConfig = configMixin.getConfig;
	getAgentDetails = configMixin.getAgentDetails;
	getAgent = configMixin.getAgent;
	getConfigTools = configMixin.getConfigTools;
	updateAgent = configMixin.updateAgent;
	deleteAgent = configMixin.deleteAgent;
	getModels = configMixin.getModels;
	getAllModels = configMixin.getAllModels;
	discoverProviderModels = configMixin.discoverProviderModels;
	updateProviderSettings = configMixin.updateProviderSettings;
	deleteProviderSettings = configMixin.deleteProviderSettings;
	updateDefaults = configMixin.updateDefaults;

	listFiles = filesMixin.listFiles;
	searchFiles = filesMixin.searchFiles;
	getFileTree = filesMixin.getFileTree;
	readFileContent = filesMixin.readFileContent;
	getSessionFiles = filesMixin.getSessionFiles;

	createBranch = branchesMixin.createBranch;
	listBranches = branchesMixin.listBranches;
	getParentSession = branchesMixin.getParentSession;
	getShareStatus = branchesMixin.getShareStatus;
	shareSession = branchesMixin.shareSession;
	syncSession = branchesMixin.syncSession;

	getSessionGoal = goalsMixin.getSessionGoal;
	listGoals = goalsMixin.listGoals;
	createSessionGoal = goalsMixin.createSessionGoal;
	updateGoal = goalsMixin.updateGoal;
	addGoalTasks = goalsMixin.addGoalTasks;
	updateGoalTask = goalsMixin.updateGoalTask;
	deleteGoalTask = goalsMixin.deleteGoalTask;
	startGoal = goalsMixin.startGoal;
	listSessionSubagents = goalsMixin.listSessionSubagents;

	approveToolCall = approvalMixin.approveToolCall;
	getPendingApprovals = approvalMixin.getPendingApprovals;
	submitSecureInput = secureInputMixin.submitSecureInput;
	cancelSecureInput = secureInputMixin.cancelSecureInput;
	getPendingSecureInputs = secureInputMixin.getPendingSecureInputs;

	getOttoRouterBalance = ottorouterMixin.getOttoRouterBalance;
	getOttoRouterWallet = ottorouterMixin.getOttoRouterWallet;
	getOttoRouterUsdcBalance = ottorouterMixin.getOttoRouterUsdcBalance;
	getPolarTopupEstimate = ottorouterMixin.getPolarTopupEstimate;
	createPolarCheckout = ottorouterMixin.createPolarCheckout;
	selectTopupMethod = ottorouterMixin.selectTopupMethod;
	cancelTopup = ottorouterMixin.cancelTopup;
	getPendingTopup = ottorouterMixin.getPendingTopup;
	getPolarTopupStatus = ottorouterMixin.getPolarTopupStatus;
	getRazorpayTopupEstimate = ottorouterMixin.getRazorpayTopupEstimate;
	createRazorpayOrder = ottorouterMixin.createRazorpayOrder;
	verifyRazorpayPayment = ottorouterMixin.verifyRazorpayPayment;

	getAuthStatus = authMixin.getAuthStatus;
	setupOttoRouterWallet = authMixin.setupOttoRouterWallet;
	importOttoRouterWallet = authMixin.importOttoRouterWallet;
	exportOttoRouterWallet = authMixin.exportOttoRouterWallet;
	addProvider = authMixin.addProvider;
	removeProvider = authMixin.removeProvider;
	completeOnboarding = authMixin.completeOnboarding;
	getOAuthStartUrl = authMixin.getOAuthStartUrl;
	getOAuthUrl = authMixin.getOAuthUrl;
	exchangeOAuthCode = authMixin.exchangeOAuthCode;
	startOpenAIDeviceFlow = authMixin.startOpenAIDeviceFlow;
	pollOpenAIDeviceFlow = authMixin.pollOpenAIDeviceFlow;
	startCopilotDeviceFlow = authMixin.startCopilotDeviceFlow;
	pollCopilotDeviceFlow = authMixin.pollCopilotDeviceFlow;
	startKimiDeviceFlow = authMixin.startKimiDeviceFlow;
	pollKimiDeviceFlow = authMixin.pollKimiDeviceFlow;
	getCopilotAuthMethods = authMixin.getCopilotAuthMethods;
	saveCopilotToken = authMixin.saveCopilotToken;
	importCopilotTokenFromGh = authMixin.importCopilotTokenFromGh;
	getCopilotDiagnostics = authMixin.getCopilotDiagnostics;
	getProviderUsage = authMixin.getProviderUsage;

	listSkills = skillsMixin.listSkills;
	getSkill = skillsMixin.getSkill;
	getSkillFiles = skillsMixin.getSkillFiles;
	getSkillFileContent = skillsMixin.getSkillFileContent;
	getSkillsConfig = skillsMixin.getSkillsConfig;
	updateSkillsConfig = skillsMixin.updateSkillsConfig;

	listRecipes = recipesMixin.listRecipes;
	saveRecipe = recipesMixin.saveRecipe;
	deleteRecipe = recipesMixin.deleteRecipe;

	listPlugins = pluginsMixin.listPlugins;
	listPluginRegistry = pluginsMixin.listPluginRegistry;
	installPlugin = pluginsMixin.installPlugin;
	removePlugin = pluginsMixin.removePlugin;
	enablePlugin = pluginsMixin.enablePlugin;
	disablePlugin = pluginsMixin.disablePlugin;
	updatePlugin = pluginsMixin.updatePlugin;

	getUsageStats = usageMixin.getUsageStats;
	getGlobalUsageStats = usageMixin.getGlobalUsageStats;

	getDictationStatus = dictationMixin.getDictationStatus;
	listDictationModels = dictationMixin.listDictationModels;
	installDictationModel = dictationMixin.installDictationModel;
	removeDictationModel = dictationMixin.removeDictationModel;
	createDictationSession = dictationMixin.createDictationSession;
	getDictationModelInstallEventsUrl =
		dictationMixin.getDictationModelInstallEventsUrl;
}

export const apiClient = new ApiClient();
