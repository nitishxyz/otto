import { sessionsMixin } from './sessions';
import { gitMixin } from './git';
import { configMixin } from './config';
import { filesMixin } from './files';
import { branchesMixin } from './branches';
import { approvalMixin } from './approval';
import { ottorouterMixin } from './ottorouter';
import { authMixin } from './auth';
import { skillsMixin } from './skills';
import { usageMixin } from './usage';

export { configureApiClient } from './utils';

class ApiClient {
	getSessions = sessionsMixin.getSessions;
	getSessionsPage = sessionsMixin.getSessionsPage;
	createSession = sessionsMixin.createSession;
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

	getConfig = configMixin.getConfig;
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

	approveToolCall = approvalMixin.approveToolCall;
	getPendingApprovals = approvalMixin.getPendingApprovals;

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
	startCopilotDeviceFlow = authMixin.startCopilotDeviceFlow;
	pollCopilotDeviceFlow = authMixin.pollCopilotDeviceFlow;
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

	getUsageStats = usageMixin.getUsageStats;
}

export const apiClient = new ApiClient();
