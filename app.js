'use strict';
// Firebase Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- App Constants ---
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
const closeModalBtn = document.getElementById('closeModalBtn');
const subscriptionModal = document.getElementById('subscriptionModal');
const modalContent = document.getElementById('modalContent');
const subscriptionForm = document.getElementById('subscriptionForm');
const subscriptionsList = document.getElementById('subscriptionsList');
const emptyState = document.getElementById('emptyState');
const totalSpendingEl = document.getElementById('totalSpending');
const notification = document.getElementById('notification');
const notificationContent = document.getElementById('notificationContent');
const confirmModal = document.getElementById('confirmModal');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// --- Form Fields ---
const subscriptionIdField = document.getElementById('subscriptionId');
const serviceNameField = document.getElementById('serviceName');
const amountField = document.getElementById('amount');
const currencyField = document.getElementById('currency');
const billingCycleField = document.getElementById('billingCycle');
const categoryField = document.getElementById('category');
const nextPaymentDateField = document.getElementById('nextPaymentDate');
const modalTitle = document.getElementById('modalTitle');

// --- App State ---
let app, db, auth;
let userId, subscriptionsCollection;
let unsubscribe; 
let subscriptions = [];
let subscriptionToDeleteId = null;

// =======================================================================
// PASTE YOUR FIREBASE CONFIGURATION OBJECT HERE
const firebaseConfig = {
  apiKey: "AIzaSyAzw99mWK9lHlMpFpcJ31wrAsrtGZfxj_k",
  authDomain: "subwatch-subscription-re-567e2.firebaseapp.com",
  projectId: "subwatch-subscription-re-567e2",
  storageBucket: "subwatch-subscription-re-567e2.firebasestorage.app",
  messagingSenderId: "132090557441",
  appId: "1:132090557441:web:ac16dc7bc8c7bf4ddcbc00",
  measurementId: "G-01Z35NDF7P"
};
// =======================================================================


// --- Helper Functions ---

const getDaysRemaining = (dateString) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [year, month, day] = dateString.split('-').map(Number);
    const paymentDate = new Date(year, month - 1, day);
    paymentDate.setHours(0, 0, 0, 0);
    const diffTime = paymentDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const getDaysRemainingText = (days) => {
    if (days < 0) return 'Протерміновано';
    if (days === 0) return 'Сьогодні';
    if (days === 1) return '1 день';
    if (days > 1 && days < 5) return `${days} дні`;
    return `${days} днів`;
};

const getDaysRemainingInfo = (days) => {
    let text = `Залишилось ${getDaysRemainingText(days)}`;
    let colorClass = 'bg-green-500';
    let textColorClass = 'text-green-400';

    if (days < 0) {
        text = `Протерміновано на ${getDaysRemainingText(Math.abs(days))}`;
        colorClass = 'bg-red-500';
        textColorClass = 'text-red-400';
    } else if (days <= URGENT_DAYS_THRESHOLD) {
        colorClass = 'bg-red-500';
        textColorClass = 'text-red-400';
    } else if (days <= WARNING_DAYS_THRESHOLD) {
        colorClass = 'bg-yellow-500';
        textColorClass = 'text-yellow-400';
    }
    return { text, colorClass, textColorClass };
};

const getCurrencySymbol = (currency) => {
    const CURRENCY_SYMBOLS = { UAH: '₴', USD: '$', EUR: '€' };
    return CURRENCY_SYMBOLS[currency] || '';
};

// --- UI Rendering Functions ---

const createSubscriptionElement = (sub) => {
    const daysRemaining = getDaysRemaining(sub.nextPaymentDate);
    const { text, colorClass, textColorClass } = getDaysRemainingInfo(daysRemaining);
    const formattedDate = new Date(sub.nextPaymentDate).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    const currencySymbol = getCurrencySymbol(sub.currency);

    const subElement = document.createElement('div');
    subElement.className = `bg-gray-800 p-4 rounded-lg shadow-md flex items-center justify-between transition-transform transform hover:-translate-y-1 cursor-pointer`;
    subElement.dataset.id = sub.id;
    
    subElement.innerHTML = `
        <div class="flex items-center space-x-4 flex-1 min-w-0">
             <div class="w-2.5 h-16 rounded-full ${colorClass}"></div>
             <div class="min-w-0">
                <div class="flex items-center gap-x-3">
                    <p class="font-bold text-lg text-white truncate">${sub.serviceName}</p>
                    ${sub.category ? `<span class="category-badge">${sub.category}</span>` : ''}
                </div>
                <p class="text-sm text-gray-400">${formattedDate}</p>
            </div>
        </div>
        <div class="flex items-center space-x-4 ml-4">
             <div class="text-right">
                <p class="font-semibold text-lg text-white">${sub.amount} ${currencySymbol}</p>
                <p class="text-xs font-medium ${textColorClass}">${text}</p>
            </div>
            <button class="delete-btn text-gray-500 hover:text-red-500 transition p-2" data-id="${sub.id}">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
            </button>
        </div>
    `;
    return subElement;
};

const renderTotalSpending = () => {
    const totals = subscriptions.reduce((acc, sub) => {
        if (!acc[sub.currency]) {
            acc[sub.currency] = 0;
        }
        // FIXED: Added fallback for billingCycle
        const isYearly = (sub.billingCycle || 'monthly') === 'yearly';
        const amount = isYearly ? parseFloat(sub.amount) / 12 : parseFloat(sub.amount);
        acc[sub.currency] += amount;
        return acc;
    }, {});

    const parts = Object.entries(totals).map(([currency, amount]) => 
        `<strong class="text-white">${amount.toFixed(2)} ${getCurrencySymbol(currency)}</strong>`
    );

    totalSpendingEl.innerHTML = parts.length > 0 ? `Приблизні витрати на місяць: ${parts.join(' + ')}` : '';
};


const checkNotifications = () => {
    const upcomingSubs = subscriptions.filter(sub => {
        const days = getDaysRemaining(sub.nextPaymentDate);
        return days >= 0 && days <= URGENT_DAYS_THRESHOLD;
    });

    if (upcomingSubs.length > 0) {
        notificationContent.innerHTML = upcomingSubs.map(sub => 
            `<p class="mb-1"><strong>${sub.serviceName}</strong> - оплата через ${getDaysRemainingText(getDaysRemaining(sub.nextPaymentDate))}.</p>`
        ).join('');
        notification.classList.remove('hidden', 'bg-green-500', 'bg-red-500');
        notification.classList.add('bg-yellow-500');
        setTimeout(() => notification.classList.add('hidden'), 8000);
    } else {
        notification.classList.add('hidden');
    }
};

const showNotification = (message, isError = false) => {
    notificationContent.innerHTML = `<p>${message}</p>`;
    notification.classList.remove('hidden', 'bg-yellow-500', 'bg-red-500', 'bg-green-500');
    notification.classList.add(isError ? 'bg-red-500' : 'bg-green-500');
    setTimeout(() => notification.classList.add('hidden'), 5000);
};

const updateUIOnDataChange = () => {
    const sortedSubs = [...subscriptions].sort((a, b) => getDaysRemaining(a.nextPaymentDate) - getDaysRemaining(b.nextPaymentDate));
    subscriptionsList.innerHTML = ''; 
    sortedSubs.forEach(sub => {
        subscriptionsList.appendChild(createSubscriptionElement(sub));
    });
    
    const hasSubscriptions = subscriptions.length > 0;
    emptyState.classList.toggle('hidden', hasSubscriptions);
    totalSpendingEl.classList.toggle('hidden', !hasSubscriptions);

    if (hasSubscriptions) {
        renderTotalSpending();
        checkNotifications();
    }
};

// --- Modal Management ---
const showModal = (isEdit = false, sub = null) => {
    subscriptionForm.reset();
    if (isEdit && sub) {
        modalTitle.textContent = "Редагувати Підписку";
        subscriptionIdField.value = sub.id;
        serviceNameField.value = sub.serviceName;
        amountField.value = sub.amount;
        currencyField.value = sub.currency;
        billingCycleField.value = sub.billingCycle || 'monthly';
        categoryField.value = sub.category || '';
        nextPaymentDateField.value = sub.nextPaymentDate;
    } else {
        modalTitle.textContent = "Нова Підписка";
        subscriptionIdField.value = '';
        const today = new Date();
        nextPaymentDateField.setAttribute('min', today.toISOString().split('T')[0]);
        today.setDate(today.getDate() + 1);
        nextPaymentDateField.value = today.toISOString().split('T')[0];
    }
    subscriptionModal.classList.remove('hidden');
    setTimeout(() => {
        modalContent.classList.add('scale-100');
        serviceNameField.focus();
    }, 10);
};

const hideModal = () => {
    modalContent.classList.remove('scale-100');
    subscriptionModal.classList.add('hidden');
};

const showConfirmModal = (id) => {
    subscriptionToDeleteId = id;
    confirmModal.classList.remove('hidden');
};

const hideConfirmModal = () => {
    subscriptionToDeleteId = null;
    confirmModal.classList.add('hidden');
};

// --- Firebase & Data Logic ---

// NEW: Function to automatically update overdue subscriptions
const updateOverdueSubscriptions = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const updates = [];

    for (const sub of subscriptions) {
        const [year, month, day] = sub.nextPaymentDate.split('-').map(Number);
        const paymentDate = new Date(year, month - 1, day);
        
        if (paymentDate < today) {
            let nextDate = new Date(paymentDate);
            while (nextDate < today) {
                if ((sub.billingCycle || 'monthly') === 'yearly') {
                    nextDate.setFullYear(nextDate.getFullYear() + 1);
                } else {
                    nextDate.setMonth(nextDate.getMonth() + 1);
                }
            }
            
            const updatedDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
            const docRef = doc(db, `users/${userId}/subscriptions`, sub.id);
            updates.push(updateDoc(docRef, { nextPaymentDate: updatedDate }));
        }
    }
    
    if (updates.length > 0) {
        await Promise.all(updates);
        console.log(`${updates.length} subscription(s) were updated.`);
    }
};

const listenForSubscriptions = () => {
    if (!subscriptionsCollection) return;
    if (unsubscribe) unsubscribe();

    unsubscribe = onSnapshot(query(subscriptionsCollection), async (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const sourceData = { id: change.doc.id, ...change.doc.data() };
            if (change.type === "added") {
                subscriptions.push(sourceData);
            }
            if (change.type === "modified") {
                const index = subscriptions.findIndex(s => s.id === sourceData.id);
                if (index > -1) subscriptions[index] = sourceData;
            }
            if (change.type === "removed") {
                subscriptions = subscriptions.filter(s => s.id !== sourceData.id);
            }
        });
        
        await updateOverdueSubscriptions();
        updateUIOnDataChange();
        
    }, (error) => {
        console.error("Error listening to subscriptions:", error);
        showNotification("Не вдалося завантажити підписки.", true);
    });
};

const initializeFirebase = () => {
    try {
        // FIXED: Corrected Firebase config check
        if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
            console.error("Firebase config is not set correctly. Please paste your config object.");
            loginContainer.innerHTML = `<p class="text-red-400">Помилка конфігурації Firebase.</p>`;
            return;
        }
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        handleAuthState();
    } catch (e) {
        console.error("Firebase initialization failed:", e);
    }
};

const handleAuthState = () => {
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
};

const updateUIForUser = (user) => {
    userProfile.classList.remove('hidden');
    appContent.classList.remove('hidden');
    loginContainer.classList.add('hidden');
    userAvatar.src = user.photoURL || `https://placehold.co/40x40/64748b/ffffff?text=${user.displayName?.[0] || 'U'}`;
    userName.textContent = user.displayName || 'Користувач';
};

const updateUIForGuest = () => {
    if (unsubscribe) unsubscribe();
    subscriptions = [];
    subscriptionsList.innerHTML = '';
    updateUIOnDataChange();
    userProfile.classList.add('hidden');
    appContent.classList.add('hidden');
    loginContainer.classList.remove('hidden');
};

const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Google Sign-In failed:", error);
        showNotification("Помилка входу через Google.", true);
    }
};

const signOutUser = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Sign-Out failed:", error);
    }
};

// --- Event Listeners ---
const setupEventListeners = () => {
    signInBtn.addEventListener('click', signInWithGoogle);
    signOutBtn.addEventListener('click', signOutUser);
    openModalBtn.addEventListener('click', () => showModal());
    closeModalBtn.addEventListener('click', hideModal);
    confirmCancelBtn.addEventListener('click', hideConfirmModal);
    
    subscriptionModal.addEventListener('click', (e) => {
        if (e.target === subscriptionModal) hideModal();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!subscriptionModal.classList.contains('hidden')) hideModal();
            if (!confirmModal.classList.contains('hidden')) hideConfirmModal();
        }
    });

    subscriptionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitButton = e.target.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = 'Збереження...';

        const id = subscriptionIdField.value;
        const subscriptionData = {
            serviceName: serviceNameField.value.trim(),
            amount: parseFloat(amountField.value),
            currency: currencyField.value,
            billingCycle: billingCycleField.value,
            category: categoryField.value.trim(),
            nextPaymentDate: nextPaymentDateField.value,
        };
        
        try {
            if (id) {
                await updateDoc(doc(db, `users/${userId}/subscriptions`, id), subscriptionData);
                showNotification("Підписку успішно оновлено!");
            } else {
                await addDoc(subscriptionsCollection, subscriptionData);
                showNotification("Підписку успішно додано!");
            }
            hideModal();
        } catch (error) {
            console.error("Error saving subscription:", error);
            showNotification("Помилка: не вдалося зберегти підписку.", true);
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });
    
    subscriptionsList.addEventListener('click', (e) => {
        const target = e.target;
        const deleteButton = target.closest('.delete-btn');
        if (deleteButton) {
            showConfirmModal(deleteButton.dataset.id);
            return;
        }
        
        const card = target.closest('[data-id]');
        if (card) {
            const subToEdit = subscriptions.find(s => s.id === card.dataset.id);
            if (subToEdit) showModal(true, subToEdit);
        }
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!subscriptionToDeleteId) return;

        const originalButtonText = confirmDeleteBtn.innerHTML;
        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.innerHTML = 'Видалення...';
        
        try {
            await deleteDoc(doc(db, `users/${userId}/subscriptions`, subscriptionToDeleteId));
            showNotification("Підписку видалено.");
        } catch (error) {
            console.error("Error deleting subscription:", error);
            showNotification("Помилка: не вдалося видалити підписку.", true);
        } finally {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.innerHTML = originalButtonText;
            hideConfirmModal();
        }
    });
};

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initializeFirebase();
});


