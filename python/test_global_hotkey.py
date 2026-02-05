"""Tests for GlobalHotkeyListener win32 event suppression."""

import platform
import types
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def listener():
    """Create a GlobalHotkeyListener with a temp data dir."""
    import tempfile
    from global_hotkey import GlobalHotkeyListener

    with tempfile.TemporaryDirectory() as tmp:
        yield GlobalHotkeyListener(data_dir=tmp)


class TestGetTargetVk:
    """Test _get_target_vk returns correct virtual-key codes."""

    def test_special_key(self, listener):
        from pynput.keyboard import Key
        listener._target_key = Key.space
        vk = listener._get_target_vk()
        assert vk is not None
        assert isinstance(vk, int)

    def test_keycode_with_vk(self, listener):
        from pynput.keyboard import KeyCode
        listener._target_key = KeyCode.from_vk(0x70)  # F1
        vk = listener._get_target_vk()
        assert vk == 0x70

    def test_mouse_button_returns_none(self, listener):
        from pynput.mouse import Button
        listener._target_key = Button.middle
        vk = listener._get_target_vk()
        assert vk is None


class TestWin32KbFilter:
    """Test _win32_kb_filter suppresses only the PTT key."""

    def test_suppresses_matching_key(self, listener):
        from pynput.keyboard import Key
        listener._key_type = "keyboard"
        listener._target_key = Key.space
        target_vk = listener._get_target_vk()

        # Mock the listener's suppress_event method
        listener._kb_listener = MagicMock()

        # Simulate a Win32 keyboard event with matching vkCode
        data = types.SimpleNamespace(vkCode=target_vk)
        listener._win32_kb_filter(0x0100, data)  # WM_KEYDOWN

        listener._kb_listener.suppress_event.assert_called_once()

    def test_ignores_non_matching_key(self, listener):
        from pynput.keyboard import Key
        listener._key_type = "keyboard"
        listener._target_key = Key.space
        target_vk = listener._get_target_vk()

        listener._kb_listener = MagicMock()

        # Different vkCode
        data = types.SimpleNamespace(vkCode=target_vk + 1)
        listener._win32_kb_filter(0x0100, data)

        listener._kb_listener.suppress_event.assert_not_called()

    def test_ignores_when_key_type_is_mouse(self, listener):
        from pynput.keyboard import Key
        listener._key_type = "mouse"
        listener._target_key = Key.space

        listener._kb_listener = MagicMock()

        data = types.SimpleNamespace(vkCode=0x20)  # VK_SPACE
        result = listener._win32_kb_filter(0x0100, data)

        assert result is True
        listener._kb_listener.suppress_event.assert_not_called()


class TestWin32MouseFilter:
    """Test _win32_mouse_filter suppresses only the PTT button."""

    def test_suppresses_middle_click(self, listener):
        from pynput.mouse import Button
        listener._key_type = "mouse"
        listener._target_key = Button.middle

        listener._mouse_listener = MagicMock()

        data = types.SimpleNamespace(mouseData=0)
        listener._win32_mouse_filter(0x0207, data)  # WM_MBUTTONDOWN

        listener._mouse_listener.suppress_event.assert_called_once()

    def test_suppresses_xbutton1(self, listener):
        from pynput.mouse import Button
        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        if btn4 is None:
            pytest.skip("pynput version has no x1/button8")

        listener._key_type = "mouse"
        listener._target_key = btn4
        listener._mouse_listener = MagicMock()

        # XBUTTON1 = hiword 1
        data = types.SimpleNamespace(mouseData=(1 << 16))
        listener._win32_mouse_filter(0x020B, data)  # WM_XBUTTONDOWN

        listener._mouse_listener.suppress_event.assert_called_once()

    def test_ignores_wrong_xbutton(self, listener):
        from pynput.mouse import Button
        btn4 = getattr(Button, "x1", None) or getattr(Button, "button8", None)
        if btn4 is None:
            pytest.skip("pynput version has no x1/button8")

        listener._key_type = "mouse"
        listener._target_key = btn4
        listener._mouse_listener = MagicMock()

        # XBUTTON2 = hiword 2 (wrong button)
        data = types.SimpleNamespace(mouseData=(2 << 16))
        listener._win32_mouse_filter(0x020B, data)

        listener._mouse_listener.suppress_event.assert_not_called()

    def test_ignores_when_key_type_is_keyboard(self, listener):
        from pynput.mouse import Button
        listener._key_type = "keyboard"
        listener._target_key = Button.middle

        listener._mouse_listener = MagicMock()

        data = types.SimpleNamespace(mouseData=0)
        result = listener._win32_mouse_filter(0x0207, data)

        assert result is True
        listener._mouse_listener.suppress_event.assert_not_called()


class TestStartPynputWindows:
    """Test that win32_event_filter is passed on Windows."""

    @patch("platform.system", return_value="Windows")
    def test_passes_win32_filters_on_windows(self, mock_sys, listener):
        """On Windows, pynput listeners should receive win32_event_filter."""
        from pynput.keyboard import Key

        with patch("pynput.keyboard.Listener") as MockKbListener, \
             patch("pynput.mouse.Listener") as MockMouseListener:
            mock_kb = MagicMock()
            mock_mouse = MagicMock()
            MockKbListener.return_value = mock_kb
            MockMouseListener.return_value = mock_mouse

            result = listener._start_pynput("Space")

            assert result is True
            # Check win32_event_filter was passed
            kb_call_kwargs = MockKbListener.call_args[1]
            mouse_call_kwargs = MockMouseListener.call_args[1]
            assert "win32_event_filter" in kb_call_kwargs
            assert "win32_event_filter" in mouse_call_kwargs

    @patch("platform.system", return_value="Linux")
    def test_no_win32_filters_on_linux(self, mock_sys, listener):
        """On Linux, pynput listeners should NOT receive win32_event_filter."""
        with patch("pynput.keyboard.Listener") as MockKbListener, \
             patch("pynput.mouse.Listener") as MockMouseListener:
            mock_kb = MagicMock()
            mock_mouse = MagicMock()
            MockKbListener.return_value = mock_kb
            MockMouseListener.return_value = mock_mouse

            result = listener._start_pynput("Space")

            assert result is True
            kb_call_kwargs = MockKbListener.call_args[1]
            mouse_call_kwargs = MockMouseListener.call_args[1]
            assert "win32_event_filter" not in kb_call_kwargs
            assert "win32_event_filter" not in mouse_call_kwargs
