/* ============================================================
   To-Do List App — Supabase-backed
   State-driven, XSS-safe rendering, persisted to Supabase
   ============================================================ */
(function () {
  'use strict';

  // ---- Supabase config ----
  const SUPABASE_URL = 'https://lkxsuxseagzywqhhvdns.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_q_CMEuW_dNgZG3FOK9dTpA_PBCX8CeX';

  // Singleton client (avoid overwriting the library namespace)
  const sbClient = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  const state = {
    tasks: []
  };

  // Tracks whether we've fallen back to local storage
  let usingLocalFallback = false;

  const dateInput = document.getElementById('todo-date');
  const taskInput = document.getElementById('todo-task');
  const addBtn = document.getElementById('todo-add');
  const list = document.getElementById('todo-list');
  const emptyMsg = document.getElementById('todo-empty');
  const counter = document.getElementById('todo-counter');
  const prioritySelect = document.getElementById('todo-priority');
  const emojiButtons = document.querySelectorAll('.emoji-btn');
  const statusMsg = document.getElementById('todo-status');

  // ---- Local storage helpers (fallback when Supabase is unreachable) ----

  function loadLocal() {
    try {
      const raw = localStorage.getItem('todo-tasks');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem('todo-tasks', JSON.stringify(state.tasks));
    } catch (e) { /* ignore */ }
  }

  // Detect errors that should trigger local-storage fallback
  // (network failures, RLS policy violations, schema issues, etc.)
  function shouldFallback(err) {
    if (!err) return false;
    const msg = (err.message || err.toString || '').toString();
    return /Failed to fetch|NetworkError|network|timeout|ERR_NETWORK|row-level security|rls|permission|policy|Could not find the|schema cache|JWT|invalid api key/i.test(msg);
  }

  // Default date to today
  dateInput.valueAsDate = new Date();

  let selectedEmoji = '';

  // Emoji picker: highlight the clicked button and remember the emoji
  emojiButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      emojiButtons.forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      selectedEmoji = btn.getAttribute('data-emoji') || '';
    });
  });

  function showStatus(text, isError) {
    if (statusMsg) {
      statusMsg.textContent = text;
      statusMsg.classList.toggle('error', !!isError);
      statusMsg.classList.remove('hidden');
    }
  }

  function clearStatus() {
    if (statusMsg) {
      statusMsg.classList.add('hidden');
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'No date';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function render() {
    list.innerHTML = '';

    const total = state.tasks.length;
    const done = state.tasks.filter(function (t) { return t.is_complete; }).length;
    if (counter) {
      counter.innerHTML = '<strong>' + done + '</strong> of <strong>' + total + '</strong> tasks completed';
    }

    if (state.tasks.length === 0) {
      emptyMsg.classList.remove('hidden');
      return;
    }
    emptyMsg.classList.add('hidden');

    // Sort: undone first, then by priority (high > medium > low), then by date ascending
    const priorityWeight = { high: 3, medium: 2, low: 1 };
    const sorted = state.tasks.slice().sort(function (a, b) {
      if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;
      const wa = priorityWeight[a.priority] || 2;
      const wb = priorityWeight[b.priority] || 2;
      if (wa !== wb) return wb - wa;
      return (a.date || a.due_date || '').localeCompare(b.date || b.due_date || '');
    });

    sorted.forEach(function (task) {
      const li = document.createElement('li');
      li.className = 'todo-item' + (task.is_complete ? ' done' : '');
      li.dataset.id = task.id;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!task.is_complete;
      checkbox.setAttribute('aria-label', 'Mark task as ' + (task.is_complete ? 'not done' : 'done'));
      checkbox.addEventListener('change', function () {
        toggleTask(task.id);
      });

      const text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = task.task || task.text || '';

      if (task.emoji) {
        const emoji = document.createElement('span');
        emoji.className = 'task-emoji';
        emoji.textContent = task.emoji;
        li.appendChild(emoji);
      }

      const priorityBadge = document.createElement('span');
      const priority = task.priority || 'medium';
      priorityBadge.className = 'priority-badge ' + priority;
      priorityBadge.textContent = priority;

      const dateBadge = document.createElement('span');
      dateBadge.className = 'task-date';
      dateBadge.textContent = formatDate(task.date || task.due_date);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'todo-delete';
      deleteBtn.setAttribute('aria-label', 'Delete task');
      deleteBtn.innerHTML = '&times;';
      deleteBtn.addEventListener('click', function () {
        deleteTask(task.id, li);
      });

      li.appendChild(checkbox);
      li.appendChild(text);
      li.appendChild(priorityBadge);
      li.appendChild(dateBadge);
      li.appendChild(deleteBtn);
      list.appendChild(li);
    });
  }

  // ---- Supabase operations ----

  async function loadTasks() {
    // Try Supabase first
    if (sbClient) {
      showStatus('Loading tasks...', false);
      try {
        const { data, error } = await sbClient
          .from('todos')
          .select('*')
          .order('created_at', { ascending: true });

        if (error) throw error;

        var remoteTasks = data || [];

        // If Supabase returned tasks, use them
        if (remoteTasks.length > 0) {
          state.tasks = remoteTasks;
          usingLocalFallback = false;
          saveLocal();
          clearStatus();
          render();
          return;
        }

        // Supabase returned empty — check if we have local tasks
        // from a previous offline session
        var localTasks = loadLocal();
        if (localTasks.length > 0) {
          state.tasks = localTasks;
          usingLocalFallback = true;
          showStatus('Working offline — tasks are saved locally.', false);
          render();
          return;
        }

        // Both empty — fresh start
        state.tasks = [];
        usingLocalFallback = false;
        clearStatus();
        render();
        return;
      } catch (err) {
        if (shouldFallback(err)) {
          // Supabase unreachable or RLS blocked — fall back to local storage
          usingLocalFallback = true;
          state.tasks = loadLocal();
          showStatus('Working offline — tasks are saved locally.', false);
          render();
          return;
        }
        // Other error (unexpected)
        console.error('Supabase load error:', err);
        showStatus('Could not load tasks: ' + (err.message || err), true);
        return;
      }
    }

    // No Supabase client at all — use local storage
    usingLocalFallback = true;
    state.tasks = loadLocal();
    render();
  }

  async function addTask() {
    const text = taskInput.value.trim();
    const dueDate = dateInput.value;
    if (!text) {
      taskInput.focus();
      return;
    }

    // Local fallback mode (Supabase unreachable)
    if (usingLocalFallback || !sbClient) {
      var newTask = {
        id: 'local_' + Date.now().toString(36),
        task: text,
        date: dueDate || null,
        emoji: selectedEmoji || null,
        priority: prioritySelect.value,
        is_complete: false,
        created_at: new Date().toISOString()
      };
      state.tasks.push(newTask);
      saveLocal();
      taskInput.value = '';
      taskInput.focus();
      selectedEmoji = '';
      emojiButtons.forEach(function (b) {
        b.classList.toggle('selected', (b.getAttribute('data-emoji') || '') === '');
      });
      showStatus('Working offline — task saved locally.', false);
      render();
      return;
    }

    // Supabase mode
    try {
      const payload = {
        task: text,
        date: dueDate || null,
        emoji: selectedEmoji || null,
        priority: prioritySelect.value,
        is_complete: false
      };

      let { data, error } = await sbClient
        .from('todos')
        .insert(payload)
        .select();

      // Retry without emoji/priority if those columns don't exist
      if (error && /emoji|priority/.test(error.message || '')) {
        ({ data, error } = await sbClient
          .from('todos')
          .insert({ task: text, date: dueDate || null, is_complete: false })
          .select());
      }

      if (error) throw error;

      if (data && data.length) {
        state.tasks.push(data[0]);
      }

      saveLocal();
      taskInput.value = '';
      taskInput.focus();
      selectedEmoji = '';
      emojiButtons.forEach(function (b) {
        b.classList.toggle('selected', (b.getAttribute('data-emoji') || '') === '');
      });
      clearStatus();
      render();
    } catch (err) {
      if (shouldFallback(err)) {
        // Supabase went down — switch to local mode and save there
        usingLocalFallback = true;
        var newTask = {
          id: 'local_' + Date.now().toString(36),
          task: text,
          date: dueDate || null,
          emoji: selectedEmoji || null,
          priority: prioritySelect.value,
          is_complete: false,
          created_at: new Date().toISOString()
        };
        state.tasks.push(newTask);
        saveLocal();
        taskInput.value = '';
        taskInput.focus();
        selectedEmoji = '';
        emojiButtons.forEach(function (b) {
          b.classList.toggle('selected', (b.getAttribute('data-emoji') || '') === '');
        });
        showStatus('Working offline — task saved locally.', false);
        render();
      } else {
        console.error('Supabase insert error:', err);
        showStatus('Could not add task: ' + (err.message || err), true);
      }
    }
  }

  async function toggleTask(id) {
    const task = state.tasks.find(function (t) { return t.id === id; });
    if (!task) return;

    const newDone = !task.is_complete;

    // Local fallback mode
    if (usingLocalFallback || !sbClient) {
      task.is_complete = newDone;
      saveLocal();
      render();
      return;
    }

    // Supabase mode
    try {
      const { error } = await sbClient
        .from('todos')
        .update({ is_complete: newDone })
        .eq('id', id);

      if (error) throw error;

      task.is_complete = newDone;
      clearStatus();
      render();
    } catch (err) {
      if (shouldFallback(err)) {
        usingLocalFallback = true;
        task.is_complete = newDone;
        saveLocal();
        showStatus('Working offline — changes saved locally.', false);
        render();
      } else {
        console.error('Supabase update error:', err);
        showStatus('Could not update task: ' + (err.message || err), true);
      }
    }
  }

  async function deleteTask(id, el) {
    el.classList.add('is-removing');
    el.addEventListener('animationend', async function () {
      // Local fallback mode
      if (usingLocalFallback || !sbClient) {
        state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
        saveLocal();
        render();
        return;
      }

      // Supabase mode
      try {
        const { error } = await sbClient
          .from('todos')
          .delete()
          .eq('id', id);

        if (error) throw error;

        state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
        clearStatus();
        render();
      } catch (err) {
        if (shouldFallback(err)) {
          usingLocalFallback = true;
          state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
          saveLocal();
          showStatus('Working offline — task deleted locally.', false);
          render();
        } else {
          console.error('Supabase delete error:', err);
          showStatus('Could not delete task: ' + (err.message || err), true);
          el.classList.remove('is-removing');
        }
      }
    }, { once: true });
  }

  // Event listeners
  addBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTask();
    }
  });

  // Initial load from Supabase
  loadTasks();
})();
