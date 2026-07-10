import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { CreditCard, ExternalLink, RefreshCw } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { StableSpinner } from '../ui/StableSpinner';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import { apiClient } from '../../lib/api-client';
import { openUrl } from '../../lib/open-url';
import { toast } from '../../stores/toastStore';
import { StatusIndicator } from '../common/StatusIndicator';

const PRESET_AMOUNTS = [10, 25, 50, 100];
const MIN_AMOUNT = 5;
const MIN_AMOUNT_RAZORPAY = 2;
const MAX_AMOUNT = 500;
const POLL_INTERVAL = 5000;
const SUCCESS_PAGE_URL = 'https://share.ottocode.io/checkout/success';

type ModalView = 'amount' | 'checkout' | 'razorpay-processing' | 'confirmed';
type PaymentGateway = 'polar' | 'razorpay';

interface FeeEstimate {
	creditAmount: number;
	chargeAmount: number;
	feeAmount: number;
}

interface RazorpayEstimate {
	creditAmountUsd: number;
	chargeAmountInr: number;
	feeAmountInr: number;
	currency: string;
	exchangeRate: number;
}

interface CheckoutInfo {
	url: string;
	checkoutId: string;
	creditAmount: number;
	chargeAmount: number;
}

declare global {
	interface Window {
		Razorpay: new (
			options: Record<string, unknown>,
		) => {
			open: () => void;
			on: (event: string, handler: () => void) => void;
		};
	}
}

function loadRazorpayScript(): Promise<void> {
	return new Promise((resolve, reject) => {
		if (window.Razorpay) {
			resolve();
			return;
		}
		const script = document.createElement('script');
		script.src = 'https://checkout.razorpay.com/v1/checkout.js';
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('Failed to load Razorpay'));
		document.head.appendChild(script);
	});
}

function PolarIcon({ className = 'w-5 h-5' }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>Polar</title>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M5.08734 21.1119C10.2671 24.6182 17.3085 23.2616 20.8148 18.0818C24.3211 12.9021 22.9645 5.86065 17.7848 2.35436C12.605 -1.15192 5.56353 0.204698 2.05724 5.38446C-1.44904 10.5642 -0.0924184 17.6057 5.08734 21.1119ZM6.58958 21.2045C11.3278 23.6286 17.3384 21.3531 20.0147 16.1221C22.6909 10.891 21.0194 4.68533 16.2811 2.2612C11.543 -0.162919 5.53235 2.11252 2.8561 7.34355C0.179842 12.5745 1.85138 18.7803 6.58958 21.2045Z"
			/>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.93988 22.4416C12.2169 23.8337 17.2485 20.1561 19.1782 14.2276C21.1078 8.29898 19.2047 2.3644 14.9276 0.9723C10.6505 -0.419794 5.61905 3.25775 3.68942 9.18633C1.7598 15.1149 3.6628 21.0495 7.93988 22.4416ZM9.24825 21.991C12.868 22.7631 16.7819 18.796 17.9904 13.1305C19.1988 7.46494 17.244 2.24622 13.6243 1.47416C10.0046 0.702105 6.09064 4.66908 4.88222 10.3347C3.67381 16.0002 5.62854 21.2189 9.24825 21.991Z"
			/>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M10.2406 22.9252C13.1024 23.2308 15.9585 18.4574 16.6199 12.2635C17.2812 6.06969 15.4974 0.800854 12.6356 0.495275C9.77386 0.189695 6.91772 4.96309 6.25634 11.157C5.59498 17.3508 7.37878 22.6196 10.2406 22.9252ZM11.5798 21.04C13.6508 21.0073 15.264 16.8146 15.1828 11.6754C15.1017 6.53608 13.3568 2.39642 11.2858 2.42914C9.21463 2.46187 7.60148 6.65457 7.68268 11.7939C7.76387 16.9331 9.50864 21.0727 11.5798 21.04Z"
			/>
		</svg>
	);
}

function RazorpayIcon({ className = 'w-5 h-5' }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>Razorpay</title>
			<path d="M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24zM14.26 10.098L3.389 17.166 1.564 24h9.008l3.688-13.902Z" />
		</svg>
	);
}

export const OttoRouterTopupModal = memo(function OttoRouterTopupModal() {
	const isOpen = useOttoRouterStore((s) => s.isTopupModalOpen);
	return isOpen ? <OttoRouterTopupModalContent /> : null;
});

const OttoRouterTopupModalContent = memo(
	function OttoRouterTopupModalContent() {
		const closeModal = useOttoRouterStore((s) => s.closeTopupModal);
		const balance = useOttoRouterStore((s) => s.balance);
		const setBalance = useOttoRouterStore((s) => s.setBalance);
		const subscription = useOttoRouterStore((s) => s.subscription);

		const [view, setView] = useState<ModalView>('amount');
		const [gateway, setGateway] = useState<PaymentGateway>('polar');
		const [amount, setAmount] = useState<number>(25);
		const [customAmount, setCustomAmount] = useState<string>('');
		const [isCustom, setIsCustom] = useState(false);
		const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
		const [razorpayEstimate, setRazorpayEstimate] =
			useState<RazorpayEstimate | null>(null);
		const [isLoadingEstimate, setIsLoadingEstimate] = useState(false);
		const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
		const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
		const [isPolling, setIsPolling] = useState(false);
		const [confirmedAmount, setConfirmedAmount] = useState<number | null>(null);
		const [pollCount, setPollCount] = useState(0);
		const [isManualChecking, setIsManualChecking] = useState(false);
		const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

		const effectiveAmount = isCustom ? parseFloat(customAmount) || 0 : amount;
		const hasGoPlan = !!subscription?.active;
		const minAmount = gateway === 'razorpay' ? MIN_AMOUNT_RAZORPAY : MIN_AMOUNT;

		const fetchEstimate = useCallback(
			async (amt: number) => {
				if (amt < minAmount || amt > MAX_AMOUNT) {
					setEstimate(null);
					setRazorpayEstimate(null);
					return;
				}
				setIsLoadingEstimate(true);
				try {
					if (gateway === 'polar') {
						const result = await apiClient.getPolarTopupEstimate(amt);
						setEstimate(result);
						setRazorpayEstimate(null);
					} else {
						const result = await apiClient.getRazorpayTopupEstimate(amt);
						setRazorpayEstimate(result);
						setEstimate(null);
					}
				} catch {
					setEstimate(null);
					setRazorpayEstimate(null);
				} finally {
					setIsLoadingEstimate(false);
				}
			},
			[gateway, minAmount],
		);

		useEffect(() => {
			if (effectiveAmount >= minAmount && view === 'amount') {
				const timeout = setTimeout(() => fetchEstimate(effectiveAmount), 300);
				return () => clearTimeout(timeout);
			}
		}, [effectiveAmount, fetchEstimate, view, minAmount]);

		const stopPolling = useCallback(() => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			setIsPolling(false);
		}, []);

		useEffect(() => {
			return () => stopPolling();
		}, [stopPolling]);

		const startPolling = useCallback(
			(checkoutId: string) => {
				if (pollRef.current) return;
				setIsPolling(true);
				setPollCount(0);

				const check = async () => {
					try {
						const status = await apiClient.getPolarTopupStatus(checkoutId);
						setPollCount((c) => c + 1);
						if (status?.confirmed) {
							stopPolling();
							setConfirmedAmount(status.amountUsd);
							localStorage.removeItem('pendingPolarCheckout');

							const balanceData = await apiClient.getOttoRouterBalance();
							if (balanceData?.balance !== undefined) {
								setBalance(balanceData.balance);
							}
							setView('confirmed');
						}
					} catch {
						setPollCount((c) => c + 1);
					}
				};

				check();
				pollRef.current = setInterval(check, POLL_INTERVAL);
			},
			[stopPolling, setBalance],
		);

		const handlePresetClick = (preset: number) => {
			setAmount(preset);
			setIsCustom(false);
			setCustomAmount('');
		};

		const handleCustomAmountChange = (value: string) => {
			setCustomAmount(value);
			setIsCustom(true);
		};

		const handlePolarCheckout = async () => {
			if (effectiveAmount < MIN_AMOUNT || effectiveAmount > MAX_AMOUNT) {
				toast.error(`Amount must be between $${MIN_AMOUNT} and $${MAX_AMOUNT}`);
				return;
			}

			setIsCreatingCheckout(true);
			try {
				const result = await apiClient.createPolarCheckout(
					effectiveAmount,
					SUCCESS_PAGE_URL,
				);

				if (result.checkoutUrl && result.checkoutId) {
					const info: CheckoutInfo = {
						url: result.checkoutUrl,
						checkoutId: result.checkoutId,
						creditAmount: result.creditAmount,
						chargeAmount: result.chargeAmount,
					};
					setCheckoutInfo(info);
					localStorage.setItem('pendingPolarCheckout', result.checkoutId);
					setView('checkout');
					openUrl(result.checkoutUrl);
					startPolling(result.checkoutId);
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : 'Failed to create checkout',
				);
			} finally {
				setIsCreatingCheckout(false);
			}
		};

		const handleRazorpayCheckout = async () => {
			if (
				effectiveAmount < MIN_AMOUNT_RAZORPAY ||
				effectiveAmount > MAX_AMOUNT
			) {
				toast.error(
					`Amount must be between $${MIN_AMOUNT_RAZORPAY} and $${MAX_AMOUNT}`,
				);
				return;
			}

			setIsCreatingCheckout(true);
			try {
				await loadRazorpayScript();
				const order = await apiClient.createRazorpayOrder(effectiveAmount);

				setView('razorpay-processing');

				const rzp = new window.Razorpay({
					key: order.keyId,
					amount: order.amount,
					currency: order.currency,
					name: 'OttoRouter',
					description: `Top up $${order.creditAmountUsd.toFixed(2)} credits`,
					order_id: order.orderId,
					handler: async (response: {
						razorpay_order_id: string;
						razorpay_payment_id: string;
						razorpay_signature: string;
					}) => {
						try {
							const result = await apiClient.verifyRazorpayPayment({
								razorpay_order_id: response.razorpay_order_id,
								razorpay_payment_id: response.razorpay_payment_id,
								razorpay_signature: response.razorpay_signature,
							});

							if (result.success) {
								setConfirmedAmount(result.credited);
								const balanceData = await apiClient.getOttoRouterBalance();
								if (balanceData?.balance !== undefined) {
									setBalance(balanceData.balance);
								}
								setView('confirmed');
							}
						} catch (err) {
							toast.error(
								err instanceof Error
									? err.message
									: 'Payment verification failed',
							);
							setView('amount');
						}
					},
					modal: {
						ondismiss: () => {
							setView('amount');
						},
					},
					theme: {
						color: '#7c3aed',
					},
				});

				rzp.on('payment.failed', () => {
					toast.error('Payment failed. Please try again.');
					setView('amount');
				});

				rzp.open();
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : 'Failed to create order',
				);
				setView('amount');
			} finally {
				setIsCreatingCheckout(false);
			}
		};

		const handleCheckout = () => {
			if (gateway === 'polar') {
				handlePolarCheckout();
			} else {
				handleRazorpayCheckout();
			}
		};

		const handleCheckNow = async () => {
			if (!checkoutInfo) return;
			setIsManualChecking(true);
			try {
				const status = await apiClient.getPolarTopupStatus(
					checkoutInfo.checkoutId,
				);
				if (status?.confirmed) {
					stopPolling();
					setConfirmedAmount(status.amountUsd);
					localStorage.removeItem('pendingPolarCheckout');

					const balanceData = await apiClient.getOttoRouterBalance();
					if (balanceData?.balance !== undefined) {
						setBalance(balanceData.balance);
					}
					setView('confirmed');
				} else {
					toast.error('Payment not confirmed yet. Keep waiting or try again.');
				}
			} catch (err) {
				console.error('[OttoRouterTopupModal] Check failed:', err);
				toast.error('Failed to check payment status');
			} finally {
				setIsManualChecking(false);
			}
		};

		const handleDone = () => {
			closeModal();
		};

		const isValidAmount =
			effectiveAmount >= minAmount && effectiveAmount <= MAX_AMOUNT;

		const modalTitle =
			view === 'confirmed'
				? 'Payment Confirmed'
				: view === 'checkout'
					? 'Waiting for Payment'
					: view === 'razorpay-processing'
						? 'Processing Payment'
						: 'Add Credits';

		return (
			<Modal isOpen onClose={closeModal} title={modalTitle} maxWidth="md">
				<div className="space-y-6">
					{view === 'confirmed' && (
						<>
							<div className="py-4">
								<StatusIndicator
									status="success"
									label={`+$${confirmedAmount?.toFixed(2) ?? checkoutInfo?.creditAmount.toFixed(2)}`}
									sublabel="Credits added to your balance"
								/>
							</div>

							<button
								type="button"
								onClick={handleDone}
								className="w-full h-12 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors flex items-center justify-center gap-2"
							>
								Done
							</button>
						</>
					)}

					{view === 'razorpay-processing' && (
						<div className="py-8">
							<StatusIndicator
								status="loading"
								label="Complete payment in the Razorpay window"
								sublabel="Do not close this page"
							/>
						</div>
					)}

					{view === 'checkout' && checkoutInfo && (
						<>
							<div className="py-4">
								<StatusIndicator
									status="loading"
									label="Complete your payment"
									sublabel="A checkout window has been opened"
								/>
								<div className="flex items-center justify-center gap-2 mt-4 px-3 py-1.5 bg-muted/40 rounded-full w-fit mx-auto">
									<div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
									<span className="text-xs text-muted-foreground font-mono">
										{isPolling ? `Checking... (${pollCount})` : 'Paused'}
									</span>
								</div>
							</div>

							<div className="space-y-2">
								<button
									type="button"
									onClick={handleCheckNow}
									disabled={isManualChecking}
									className="w-full h-12 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
								>
									{isManualChecking ? (
										<StableSpinner title="Checking payment status" />
									) : (
										<RefreshCw className="w-4 h-4" />
									)}
									{isManualChecking ? 'Checking...' : 'Check Now'}
								</button>
								<button
									type="button"
									onClick={() => openUrl(checkoutInfo.url)}
									className="w-full h-11 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
								>
									<ExternalLink className="w-4 h-4" />
									Open Checkout Again
								</button>
							</div>

							<p className="text-xs text-muted-foreground text-center">
								Status checks automatically every 5 seconds. You can close this
								and it will keep checking.
							</p>
						</>
					)}

					{view === 'amount' && (
						<>
							{hasGoPlan && (
								<div className="text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2">
									You are on GO. Top-ups add extra balance for additional usage.
								</div>
							)}
							<div className="flex items-center justify-between py-3 px-4 bg-muted/40 rounded-lg">
								<span className="text-sm text-muted-foreground">
									Current Balance
								</span>
								<span className="text-lg font-mono font-semibold">
									${balance?.toFixed(2) ?? '0.00'}
								</span>
							</div>

							<div className="flex rounded-lg border border-border overflow-hidden">
								<button
									type="button"
									onClick={() => setGateway('polar')}
									className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
										gateway === 'polar'
											? 'bg-foreground text-background'
											: 'bg-transparent text-muted-foreground hover:text-foreground'
									}`}
								>
									<PolarIcon className="w-3.5 h-3.5" />
									Polar
								</button>
								<button
									type="button"
									onClick={() => setGateway('razorpay')}
									className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
										gateway === 'razorpay'
											? 'bg-foreground text-background'
											: 'bg-transparent text-muted-foreground hover:text-foreground'
									}`}
								>
									<RazorpayIcon className="w-3.5 h-3.5" />
									Razorpay
								</button>
							</div>

							<div className="space-y-4">
								<div className="grid grid-cols-4 gap-2">
									{PRESET_AMOUNTS.map((preset) => (
										<button
											key={preset}
											type="button"
											onClick={() => handlePresetClick(preset)}
											className={`h-12 text-base font-mono rounded-lg border-2 transition-all ${
												!isCustom && amount === preset
													? 'bg-foreground text-background border-foreground'
													: 'bg-transparent border-border text-foreground hover:border-foreground/40'
											}`}
										>
											${preset}
										</button>
									))}
								</div>

								<div className="relative">
									<span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">
										$
									</span>
									<input
										type="number"
										placeholder="Custom"
										value={customAmount}
										onChange={(e) => handleCustomAmountChange(e.target.value)}
										onFocus={() => setIsCustom(true)}
										min={minAmount}
										max={MAX_AMOUNT}
										step="1"
										className={`w-full h-12 pl-8 pr-4 text-base font-mono bg-transparent border-2 rounded-lg outline-none transition-all ${
											isCustom
												? 'border-foreground'
												: 'border-border focus:border-foreground/40'
										}`}
									/>
								</div>
							</div>

							<div
								className={`grid transition-all duration-200 ease-out ${
									isValidAmount
										? 'grid-rows-[1fr] opacity-100'
										: 'grid-rows-[0fr] opacity-0'
								}`}
							>
								<div className="overflow-hidden">
									<div className="space-y-3 py-4 border-t border-border">
										{isLoadingEstimate ? (
											<>
												<div className="flex justify-between items-center">
													<span className="text-sm text-muted-foreground">
														Credits
													</span>
													<div className="h-6 w-16 bg-muted/60 rounded animate-pulse" />
												</div>
												<div className="flex justify-between items-center">
													<span className="text-sm text-muted-foreground">
														Fee
													</span>
													<div className="h-4 w-12 bg-muted/60 rounded animate-pulse" />
												</div>
												<div className="flex justify-between items-center pt-3 border-t border-border">
													<span className="font-medium">Total</span>
													<div className="h-7 w-20 bg-muted/60 rounded animate-pulse" />
												</div>
											</>
										) : gateway === 'polar' && estimate ? (
											<>
												<div className="flex justify-between items-center">
													<span className="text-sm text-muted-foreground">
														Credits
													</span>
													<span className="font-mono text-lg">
														${estimate.creditAmount.toFixed(2)}
													</span>
												</div>
												<div className="flex justify-between items-center">
													<span className="text-sm text-muted-foreground">
														Fee
													</span>
													<span className="font-mono text-sm text-muted-foreground">
														+${estimate.feeAmount.toFixed(2)}
													</span>
												</div>
												<div className="flex justify-between items-center pt-3 border-t border-border">
													<span className="font-medium">Total</span>
													<span className="font-mono text-xl font-semibold">
														${estimate.chargeAmount.toFixed(2)}
													</span>
												</div>
											</>
										) : gateway === 'razorpay' && razorpayEstimate ? (
											<>
												<div className="flex justify-between items-center">
													<span className="text-sm text-muted-foreground">
														Credits
													</span>
													<span className="font-mono text-lg">
														${razorpayEstimate.creditAmountUsd.toFixed(2)}
													</span>
												</div>
												<div className="flex justify-between items-center">
													<span className="text-sm text-muted-foreground">
														Fee
													</span>
													<span className="font-mono text-sm text-muted-foreground">
														+₹{razorpayEstimate.feeAmountInr.toFixed(2)}
													</span>
												</div>
												<div className="flex justify-between items-center pt-3 border-t border-border">
													<span className="font-medium">Total</span>
													<span className="font-mono text-xl font-semibold">
														₹{razorpayEstimate.chargeAmountInr.toFixed(2)}
													</span>
												</div>
												<p className="text-[10px] text-muted-foreground text-right">
													1 USD ≈ {razorpayEstimate.exchangeRate} INR
												</p>
											</>
										) : null}
									</div>
								</div>
							</div>

							<button
								type="button"
								onClick={handleCheckout}
								disabled={!isValidAmount || isCreatingCheckout}
								className="w-full h-12 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
							>
								{isCreatingCheckout ? (
									<StableSpinner title="Creating checkout" />
								) : (
									<CreditCard className="w-4 h-4" />
								)}
								{gateway === 'polar' ? 'Pay with Card' : 'Pay with Razorpay'}
							</button>
						</>
					)}
				</div>
			</Modal>
		);
	},
);
