import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // --- Constants ---
    const URGENT_DAYS_THRESHOLD = 3;
    const WARNING_DAYS_THRESHOLD = 7;
    
    // --- DOM Elements ---
    const userProfile = document.getElementById('userProfile');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const signOutBtn = document.getElementById('signOutBtn');
    const signInBtn = document.getElementById('signInBtn');
    const loginContainer = document.getElementById('loginContainer');
    const appContent = document.getElementById('appContent');
    const openModalBtn = document.getElementById('openModalBtn');
    const subscriptionsList = document.getElementById('subscriptionsList');
    const emptyState = document.getElementById('emptyState');
    const totalSpendingEl = document.getElementById('totalSpending');
    const notification = document.getElementById('notification');
    const notificationContent = document.getElementById('notification-content');
    const notificationIcon = document.getElementById('notification-icon');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');
    const globalLoader = document.getElementById('globalLoader');
    const offlineIndicator = document.getElementById('offlineIndicator');

    // Modal Elements
    const subscriptionModal = document.getElementById('subscriptionModal');
    const confirmModal = document.getElementById('confirmModal');
    const subscriptionForm = document.getElementById('subscriptionForm');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

    // --- State ---
    let app, db, auth, userId, subscriptionsCollection;
    let subscriptions = [];
    let unsubscribe;
    let isOffline = !navigator.onLine;
    let lastCheckDate = null;

    // --- Helper Functions ---
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    const sanitizeText = (text) => {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    };
    
    const isValidDateString = (dateString) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year && 
               date.getMonth() === month - 1 && 
               date.getDate() === day;
    };

    const getDaysRemaining = (dateString) => {
        const today = new Date();
        const todayString = today.toISOString().split('T')[0];
        const todayTime = new Date(todayString + 'T00:00:00Z').getTime();
        const paymentTime = new Date(dateString + 'T00:00:00Z').getTime();
        return Math.ceil((paymentTime - todayTime) / (1000 * 60 * 60 * 24));
    };
    
    const getDaysRemainingText = (days) => {
        if (days < 0) return 'Протерміновано';
        if (days === 0) return 'Сьогодні';
        if (days === 1) return 'Завтра';
        try {
            const rtf = new Intl.RelativeTimeFormat('uk', { numeric: 'auto' });
            return `через ${rtf.format(days, 'day').replace('через ','')}`;
        } catch (e) {
            return `через ${days} днів`;
        }
    };

    const getDaysRemainingInfo = (days) => {
        let colorClass, textColorClass;
        if (days < 0) {
            colorClass = 'bg-red-400';
            textColorClass = 'text-red-500 dark:text-red-400';
        } else if (days <= URGENT_DAYS_THRESHOLD) {
            colorClass = 'bg-orange-400';
            textColorClass = 'text-orange-500 dark:text-orange-400';
        } else if (days <= WARNING_DAYS_THRESHOLD) {
            colorClass = 'bg-yellow-400';
            textColorClass = 'text-yellow-500 dark:text-yellow-400';
        } else {
            colorClass = 'bg-green-400';
            textColorClass = 'text-green-600 dark:text-green-400';
        }
        return { text: getDaysRemainingText(days), colorClass, textColorClass };
    };
    
    const getCurrencySymbol = (currency) => ({ UAH: '₴', USD: '$', EUR: '€' }[currency] || '');

    const showLoader = () => globalLoader.classList.remove('hidden');
    const hideLoader = () => globalLoader.classList.add('hidden');

    // --- Firebase & Data Management ---
    const initializeFirebase = () => {
        const firebaseConfig = {
            apiKey: "AIzaSyAzw99mWK9lHlMpFpcJ31wrAsrtGZfxj_k",
            authDomain: "subwatch-subscription-re-567e2.firebaseapp.com",
            projectId: "subwatch-subscription-re-567e2",
            storageBucket: "subwatch-subscription-re-567e2.firebasestorage.app",
            messagingSenderId: "132090557441",
            appId: "1:132090557441:web:ac16dc7bc8c7bf4ddcbc00",
            measurementId: "G-01Z35NDF7P"
        };
        
        if (!firebaseConfig || firebaseConfig.apiKey.includes("YOUR_API_KEY")) {
            showNotification("Firebase не налаштовано. Будь ласка, налаштуйте правила безпеки та конфігурацію.", true);
            hideLoader();
            return;
        }

        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    userId = user.uid;
                    updateUIForUser(user);
                    subscriptionsCollection = collection(db, `users/${userId}/subscriptions`);
                    listenForSubscriptions();
                } else {
                    updateUIForGuest();
                }
            });
        } catch (e) {
            console.error("Firebase initialization failed:", e);
            showNotification("Помилка ініціалізації Firebase.", true);
            hideLoader();
        }
    };

    const signInWithGoogle = async () => await signInWithPopup(auth, new GoogleAuthProvider()).catch(err => console.error("Google Sign-In failed:", err));
    const signOutUser = async () => await signOut(auth).catch(err => console.error("Sign-Out failed:", err));

    const updateOverdueSubscriptions = async () => {
        const todayString = new Date().toISOString().split('T')[0];
        if (lastCheckDate === todayString) return;
        lastCheckDate = todayString;

        const overdueSubs = subscriptions.filter(sub => isValidDateString(sub.nextPaymentDate) && sub.nextPaymentDate < todayString);
        if (overdueSubs.length === 0) return;

        try {
            const batch = writeBatch(db);
            overdueSubs.forEach(sub => {
                let nextDate = new Date(sub.nextPaymentDate + 'T00:00:00Z');
                const today = new Date(todayString + 'T00:00:00Z');
                
                while (nextDate < today) {
                    if (sub.billingCycle === 'yearly') {
                        nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 1);
                    } else {
                        nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
                    }
                }
                const docRef = doc(db, `users/${userId}/subscriptions`, sub.id);
                batch.update(docRef, { 
                    nextPaymentDate: nextDate.toISOString().split('T')[0]
                });
            });
            await batch.commit();
            showNotification("Протерміновані підписки було оновлено.");
        } catch (error) {
            console.error("Error updating overdue subscriptions:", error);
            showNotification("Не вдалося оновити протерміновані підписки.", true);
        }
    };

    const listenForSubscriptions = () => {
        if (!subscriptionsCollection) return;
        if (unsubscribe) unsubscribe();

        unsubscribe = onSnapshot(query(subscriptionsCollection), 
            async (snapshot) => {
                if (isOffline) {
                    isOffline = false;
                    offlineIndicator.classList.add('hidden');
                    showNotification("З'єднання відновлено.");
                }
                
                snapshot.docChanges().forEach((change) => {
                    const subData = { id: change.doc.id, ...change.doc.data() };
                    const index = subscriptions.findIndex(s => s.id === subData.id);

                    if (change.type === "added") {
                        if (index === -1) subscriptions.push(subData);
                    }
                    if (change.type === "modified") {
                        if (index > -1) subscriptions[index] = subData;
                    }
                    if (change.type === "removed") {
                        if (index > -1) subscriptions.splice(index, 1);
                    }
                });
                
                await updateOverdueSubscriptions();
                debouncedRenderUI();
                hideLoader();
            }, 
            (error) => {
                console.error("Error listening to subscriptions:", error);
                isOffline = true;
                offlineIndicator.classList.remove('hidden');
                hideLoader();
            }
        );
    };

    // --- UI Functions ---
    const showNotification = (message, isError = false) => {
        notificationContent.textContent = message;
        if (isError) {
            notification.className = "fixed bottom-5 right-5 p-4 rounded-lg shadow-lg z-50 transform transition-all duration-300 max-w-sm bg-red-500";
            notificationIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        } else {
            notification.className = "fixed bottom-5 right-5 p-4 rounded-lg shadow-lg z-50 transform transition-all duration-300 max-w-sm bg-green-500";
            notificationIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 0118 0z" /></svg>`;
        }
        notification.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(() => notification.classList.add('translate-y-20', 'opacity-0'), 4000);
    };

    const createSubscriptionElement = (sub) => {
        const el = document.createElement('div');
        el.className = 'bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 flex items-center justify-between cursor-pointer';
        el.dataset.id = sub.id;

        const daysRemaining = isValidDateString(sub.nextPaymentDate) ? getDaysRemaining(sub.nextPaymentDate) : NaN;
        const { text, colorClass, textColorClass } = getDaysRemainingInfo(daysRemaining);
        
        const dateText = isValidDateString(sub.nextPaymentDate) 
            ? new Date(sub.nextPaymentDate + 'T00:00:00Z').toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })
            : 'Некоректна дата';

        el.innerHTML = `
            <div class="flex items-center space-x-4 overflow-hidden">
                <div class="w-1.5 h-16 rounded-full flex-shrink-0 ${colorClass}"></div>
                <div class="overflow-hidden">
                    <p class="font-bold text-lg text-gray-900 dark:text-white truncate">${sanitizeText(sub.serviceName)}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">${dateText}</p>
                </div>
            </div>
            <div class="flex items-center space-x-4 flex-shrink-0">
                <div class="text-right">
                    <p class="font-semibold text-lg text-gray-900 dark:text-white">${parseFloat(sub.amount).toFixed(2)} ${getCurrencySymbol(sub.currency)}</p>
                    <p class="text-xs font-medium ${textColorClass}">${text}</p>
                </div>
                <div class="flex flex-col items-center space-y-1">
                     <span class="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded-full">${sanitizeText(sub.category || 'Загальне')}</span>
                     <button aria-label="Видалити підписку" class="delete-btn text-gray-400 hover:text-red-500 transition p-2 pointer-events-auto" data-id="${sub.id}">
                        <svg class="h-5 w-5 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                    </button>
                </div>
            </div>
        `;
        return el;
    };
    
    const renderUI = () => {
        subscriptions.sort((a, b) => getDaysRemaining(a.nextPaymentDate) - getDaysRemaining(b.nextPaymentDate));
        
        subscriptionsList.innerHTML = '';
        if (subscriptions.length === 0) {
            emptyState.classList.remove('hidden');
            totalSpendingEl.classList.add('hidden');
        } else {
            emptyState.classList.add('hidden');
            totalSpendingEl.classList.remove('hidden');
            subscriptions.forEach(sub => subscriptionsList.appendChild(createSubscriptionElement(sub)));
        }
        renderTotalSpending();
    };
    const debouncedRenderUI = debounce(renderUI, 100);

    const updateUIForUser = (user) => {
        userProfile.classList.remove('hidden');
        appContent.classList.remove('hidden');
        loginContainer.classList.add('hidden');
        userAvatar.src = user.photoURL || `https://placehold.co/40x40/64748b/ffffff?text=${sanitizeText(user.displayName?.[0] || 'U')}`;
        userName.textContent = user.displayName || 'Користувач';
    };

    const updateUIForGuest = () => {
        if (unsubscribe) unsubscribe();
        subscriptions = [];
        renderUI();
        userProfile.classList.add('hidden');
        appContent.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        hideLoader();
    };

    const renderTotalSpending = () => {
        const totals = subscriptions.reduce((acc, sub) => {
            const amount = (sub.billingCycle || 'monthly') === 'yearly' ? parseFloat(sub.amount) / 12 : parseFloat(sub.amount);
            if (!acc[sub.currency]) acc[sub.currency] = 0;
            acc[sub.currency] += amount;
            return acc;
        }, {});
        
        const parts = Object.entries(totals).sort().map(([currency, amount]) => 
            `<strong class="text-gray-900 dark:text-white">${amount.toFixed(2)} ${getCurrencySymbol(currency)}</strong>`);
        
        totalSpendingEl.innerHTML = parts.length > 0 ? `Приблизні витрати на місяць: ${parts.join(' + ')}` : '';
    };
    
    // --- Modal Management ---
    const showModal = (modalId) => {
        const modal = document.getElementById(modalId);
        const modalContent = modal.querySelector('.transform');
        modal.classList.remove('hidden');
        setTimeout(() => modalContent.classList.add('scale-100', 'opacity-100'), 10);
    };
    
    const hideModal = (modalId) => {
        const modal = document.getElementById(modalId);
        const modalContent = modal.querySelector('.transform');
        modalContent.classList.remove('scale-100', 'opacity-100');
        setTimeout(() => modal.classList.add('hidden'), 200);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        const submitButton = subscriptionForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Збереження...';

        const dateValue = subscriptionForm.nextPaymentDate.value;
        if (!isValidDateString(dateValue)) {
            showNotification("Вказано некоректну дату. Будь ласка, перевірте формат РРРР-ММ-ДД.", true);
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
            return;
        }
        
        if (dateValue < new Date().toISOString().split('T')[0]) {
             showNotification("Дата не може бути в минулому.", true);
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
            return;
        }

        const id = subscriptionForm.subscriptionId.value;
        const subscriptionData = {
            serviceName: subscriptionForm.serviceName.value.trim(),
            category: subscriptionForm.category.value.trim() || 'Загальне',
            amount: parseFloat(subscriptionForm.amount.value),
            currency: subscriptionForm.currency.value,
            billingCycle: subscriptionForm.billingCycle.value,
            nextPaymentDate: dateValue,
        };

        try {
            if (id) {
                await updateDoc(doc(db, `users/${userId}/subscriptions`, id), subscriptionData);
                showNotification("Підписку оновлено!");
            } else {
                await addDoc(subscriptionsCollection, subscriptionData);
                showNotification("Підписку додано!");
            }
            hideModal('subscriptionModal');
            try { sessionStorage.removeItem('subscription-draft'); } catch(e) {}
        } catch (error) {
            console.error("Error saving subscription:", error);
            showNotification("Не вдалося зберегти підписку.", true);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    };

    const openEditModal = (sub) => {
        showModal('subscriptionModal');
        document.getElementById('modalTitle').textContent = "Редагувати Підписку";
        subscriptionForm.reset();
        
        subscriptionForm.subscriptionId.value = sub.id;
        subscriptionForm.serviceName.value = sub.serviceName;
        subscriptionForm.category.value = sub.category || '';
        subscriptionForm.amount.value = sub.amount;
        subscriptionForm.currency.value = sub.currency;
        subscriptionForm.billingCycle.value = sub.billingCycle || 'monthly';
        subscriptionForm.nextPaymentDate.value = sub.nextPaymentDate;
    };
    
    const openNewModal = () => {
        showModal('subscriptionModal');
        document.getElementById('modalTitle').textContent = "Нова Підписка";
        subscriptionForm.reset();
        restoreDraft();
        const todayString = new Date().toISOString().split('T')[0];
        subscriptionForm.nextPaymentDate.setAttribute('min', todayString);
        if(!subscriptionForm.nextPaymentDate.value) {
            subscriptionForm.nextPaymentDate.value = todayString;
        }
        setTimeout(() => subscriptionForm.serviceName.focus(), 100);
    };

    const openConfirmModal = (subId) => {
        showModal('confirmModal');
        confirmDeleteBtn.onclick = async () => {
            const originalText = confirmDeleteBtn.textContent;
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = 'Видалення...';
            try {
                await deleteDoc(doc(db, `users/${userId}/subscriptions`, subId));
                showNotification("Підписку видалено.");
            } catch (error) {
                showNotification("Не вдалося видалити підписку.", true);
            } finally {
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = originalText;
                hideModal('confirmModal');
            }
        };
    }
    
    const saveDraft = () => {
        const draft = {
            serviceName: subscriptionForm.serviceName.value,
            category: subscriptionForm.category.value,
            amount: subscriptionForm.amount.value,
            currency: subscriptionForm.currency.value,
            billingCycle: subscriptionForm.billingCycle.value,
            nextPaymentDate: subscriptionForm.nextPaymentDate.value,
        };
        try { sessionStorage.setItem('subscription-draft', JSON.stringify(draft)); } catch (e) {}
    };
    const debouncedSaveDraft = debounce(saveDraft, 500);

    const restoreDraft = () => {
        try {
            const draft = JSON.parse(sessionStorage.getItem('subscription-draft'));
            if (draft) {
                subscriptionForm.serviceName.value = draft.serviceName || '';
                subscriptionForm.category.value = draft.category || '';
                subscriptionForm.amount.value = draft.amount || '';
                subscriptionForm.currency.value = draft.currency || 'UAH';
                subscriptionForm.billingCycle.value = draft.billingCycle || 'monthly';
                subscriptionForm.nextPaymentDate.value = draft.nextPaymentDate || '';
            }
        } catch (e) {}
    };


    // --- Theme Management ---
    const applyTheme = (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        sunIcon.classList.toggle('hidden', theme !== 'dark');
        moonIcon.classList.toggle('hidden', theme === 'dark');
    };

    const toggleTheme = () => {
        const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(newTheme);
        try { localStorage.setItem('theme', newTheme); } catch (e) { console.warn("Could not save theme to localStorage:", e); }
    };

    const initTheme = () => {
        try {
            const savedTheme = localStorage.getItem('theme');
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            applyTheme(savedTheme || (systemPrefersDark ? 'dark' : 'light'));
        } catch (e) {
            console.warn("Could not read theme from localStorage:", e);
            applyTheme('light');
        }
    };

    // --- Event Listeners ---
    const initEventListeners = () => {
        openModalBtn.addEventListener('click', openNewModal);
        signInBtn.addEventListener('click', signInWithGoogle);
        signOutBtn.addEventListener('click', signOutUser);
        themeToggleBtn.addEventListener('click', toggleTheme);

        subscriptionModal.addEventListener('click', (e) => e.target === subscriptionModal && hideModal('subscriptionModal'));
        document.getElementById('closeModalBtn').addEventListener('click', () => hideModal('subscriptionModal'));
        confirmModal.addEventListener('click', (e) => e.target === confirmModal && hideModal('confirmModal'));
        document.getElementById('confirmCancelBtn').addEventListener('click', () => hideModal('confirmModal'));
        
        subscriptionForm.addEventListener('submit', handleFormSubmit);
        subscriptionForm.addEventListener('input', debouncedSaveDraft);

        subscriptionsList.addEventListener('click', (e) => {
            const card = e.target.closest('[data-id]');
            const deleteButton = e.target.closest('.delete-btn');
            
            if (deleteButton) {
                e.stopPropagation();
                openConfirmModal(deleteButton.dataset.id);
            } else if (card) {
                const subToEdit = subscriptions.find(s => s.id === card.dataset.id);
                if (subToEdit) openEditModal(subToEdit);
            }
        });
        
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!subscriptionModal.classList.contains('hidden')) hideModal('subscriptionModal');
                if (!confirmModal.classList.contains('hidden')) hideModal('confirmModal');
            }
        });

        window.addEventListener('online', () => {
            isOffline = false;
            offlineIndicator.classList.add('hidden');
            showNotification("З'єднання відновлено.");
        });

        window.addEventListener('offline', () => {
            isOffline = true;
            offlineIndicator.classList.remove('hidden');
        });
    };

    // --- Initial Load ---
    initTheme();
    showLoader();
    initializeFirebase();
    initEventListeners();
});

