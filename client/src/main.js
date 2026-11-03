import { createApp, watch } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { currentUser, sessionReady } from './auth.js';

import App from './App.vue';
import './assets/base.css';

import HomeView from './views/HomeView.vue';
const ConcertView = () => import('./views/ConcertView.vue');
const AlgorithmView = () => import('./views/AlgorithmView.vue');
const RoundView = () => import('./views/RoundView.vue');
const MethodView = () => import('./views/MethodView.vue');
const LoginView = () => import('./views/LoginView.vue');
const AccountSecurityView = () => import('./views/AccountSecurityView.vue');
const ConcertsView = () => import('./views/ConcertsView.vue');
const ListingView = () => import('./views/ListingView.vue');
const MyListingsView = () => import('./views/MyListingsView.vue');
const TicketDetailView = () => import('./views/TicketDetailView.vue');
const TicketMarketplaceView = () => import('./views/TicketMarketplaceView.vue');
const CheckoutView = () => import('./views/CheckoutView.vue');
const OrderConfirmationView = () => import('./views/OrderConfirmationView.vue');
const ChatThreadView = () => import('./views/ChatThreadView.vue');
const AdminVerificationsView = () => import('./views/AdminVerificationsView.vue');
const KakiFinderView = () => import('./views/KakiFinderView.vue');
const KakiChatListView = () => import('./views/KakiChatListView.vue');
const KakiChatView = () => import('./views/KakiChatView.vue');
const GroupChannelView = () => import('./views/GroupChannelView.vue');
const ConnectionChannelView = () => import('./views/ConnectionChannelView.vue');
const ProfileHistoryView = () => import('./views/ProfileHistoryView.vue');
const ProfileView = () => import('./views/ProfileView.vue');
const PublicProfileView = () => import('./views/PublicProfileView.vue');
const NotFoundView = () => import('./views/NotFoundView.vue');
const GroupExplorerView = () => import('./views/GroupExplorerView.vue');
const GroupConnectionsView = () => import('./views/GroupConnectionsView.vue');
const GroupMembershipView = () => import('./views/GroupMembershipView.vue');
const MeetupView = () => import('./views/MeetupView.vue');
const FeedbackView = () => import('./views/FeedbackView.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Encore' } },
    { path: '/concerts', name: 'concerts', component: ConcertsView, meta: { title: 'Concerts' } },
    { path: '/concerts/:id', name: 'concert', component: ConcertView, props: true, meta: { title: 'Concert details' } },
    {
      path: '/concerts/:id/algorithm',
      name: 'algorithm',
      component: AlgorithmView,
      props: true,
      meta: { title: 'Matching preview' },
    },
    { path: '/rounds/:id', name: 'round', component: RoundView, props: true, meta: { title: 'Group matching results' } },
    { path: '/method', name: 'method', component: MethodView, meta: { title: 'How it works' } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in' } },
    { path: '/account/security', name: 'account-security', component: AccountSecurityView, meta: { title: 'Account security' } },
    { path: '/list-ticket', name: 'list-ticket', component: ListingView, meta: { title: 'List a ticket', requiresAuth: true } },
    { path: '/my-listings', name: 'my-listings', component: MyListingsView, meta: { title: 'My listings', requiresAuth: true } },
    { path: '/tickets', name: 'tickets', component: TicketMarketplaceView, meta: { title: 'Tickets' } },
    { path: '/tickets/:id', name: 'ticket-detail', component: TicketDetailView, props: true, meta: { title: 'Ticket details' } },
    // Checkout stays unavailable until a real payment provider is configured.
    { path: '/tickets/:id/checkout', name: 'checkout', component: CheckoutView, props: true, meta: { title: 'Checkout' } },
    { path: '/orders/:id', name: 'order', component: OrderConfirmationView, props: true, meta: { title: 'Historical order' } },
    {
      path: '/operator/verifications',
      name: 'operator-verifications',
      component: AdminVerificationsView,
      meta: { title: 'Ticket verification' },
    },

    { path: '/kaki', name: 'kaki', component: KakiFinderView, meta: { title: 'Find a companion', requiresAuth: true } },
    { path: '/groups', name: 'groups', component: GroupExplorerView, meta: { title: 'Groups', requiresAuth: true } },
    { path: '/groups/connect', name: 'group-connections', component: GroupConnectionsView, meta: { title: 'My groups', requiresAuth: true } },
    { path: '/groups/connections/:id/channel', name: 'connection-channel', component: ConnectionChannelView, props: true, meta: { title: 'Connected groups chat', requiresAuth: true } },
    {
      // The group's shared room. Membership is the host's to grant, so this
      // 404s for anybody they have not added.
      path: '/groups/:id/channel',
      name: 'group-channel',
      component: GroupChannelView,
      props: true,
      meta: { title: 'Group channel', requiresAuth: true },
    },
    { path:'/groups/invite/:token',component:GroupMembershipView,props:true,meta:{title:'Join your friends',requiresAuth:true} },
    { path:'/groups/:id/members',component:GroupMembershipView,props:true,meta:{title:'Group members',requiresAuth:true} },
    { path:'/meetups',component:MeetupView,meta:{title:'Meetup planning',requiresAuth:true} },
    { path:'/meetups/:id',component:MeetupView,props:true,meta:{title:'Meetup planning',requiresAuth:true} },
    { path:'/feedback',component:FeedbackView,meta:{title:'Post-concert feedback',requiresAuth:true} },
    {
      path: '/kaki/history',
      name: 'kaki-history',
      component: ProfileHistoryView,
      meta: { title: 'Companion history', requiresAuth: true },
    },

    // One inbox; companion and ticket conversations retain their own threads.
    {
      path: '/messages',
      name: 'kaki-chat',
      component: KakiChatListView,
      meta: { title: 'Messages', requiresAuth: true },
    },
    {
      path: '/kaki/chat/:id',
      name: 'kaki-chat-thread',
      component: KakiChatView,
      props: true,
      meta: { title: 'Companion conversation', requiresAuth: true },
    },

    { path: '/chat/:id', name: 'chat-thread', component: ChatThreadView, props: true, meta: { title: 'Ticket conversation' } },
    { path: '/profile', name: 'profile', component: ProfileView, meta: { title: 'Profile' } },
    { path: '/people/:id', name: 'public-profile', component: PublicProfileView, props: true, meta: { title: 'Concert vibe', requiresAuth: true } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { title: 'Page not found' } },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', top: 80 };
    return { top: 0 };
  },
});

// Restore the session before deciding whether a protected page can open.
router.beforeEach(async (to) => {
  if (!to.meta?.requiresAuth) return true;
  if (!sessionReady.value) {
    await new Promise((resolve) => {
      const stop = watch(sessionReady, (ready) => {
        if (!ready) return;
        stop();
        resolve();
      }, { immediate: true });
    });
  }
  if (currentUser.value) return true;
  return { path: '/login', query: { redirect: to.fullPath } };
});

router.afterEach((to) => {
  const title = to.name === 'group-connections'
    ? ({ create: 'Create a group', connections: 'Connect groups' }[to.query.view] ?? 'My groups')
    : to.meta?.title;
  document.title = title && title !== 'Encore' ? `${title} | Encore` : 'Encore';
});

createApp(App).use(router).mount('#app');
