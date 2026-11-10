"""Owned Windows process tree. Debug children die if the controller crashes."""
import ctypes as C
from ctypes import wintypes as W
import os
import subprocess

K = C.WinDLL("kernel32", use_last_error=True)
U = C.WinDLL("user32", use_last_error=True)
SIZE = C.c_size_t

class STARTUPINFO(C.Structure):
    _fields_ = [("cb", W.DWORD), ("reserved", W.LPWSTR), ("desktop", W.LPWSTR), ("title", W.LPWSTR),
                *[(n, W.DWORD) for n in ("x", "y", "width", "height", "xc", "yc", "fill", "flags")],
                ("show", W.WORD), ("reserved_size", W.WORD), ("reserved_bytes", C.c_void_p),
                ("stdin", W.HANDLE), ("stdout", W.HANDLE), ("stderr", W.HANDLE)]

class PROCESSINFO(C.Structure):
    _fields_ = [("process", W.HANDLE), ("thread", W.HANDLE), ("pid", W.DWORD), ("tid", W.DWORD)]

class BASICLIMIT(C.Structure):
    _fields_ = [("process_time", C.c_int64), ("job_time", C.c_int64), ("flags", W.DWORD),
                ("minimum", SIZE), ("maximum", SIZE), ("active", W.DWORD), ("affinity", SIZE),
                ("priority", W.DWORD), ("scheduling", W.DWORD)]

class EXTENDEDLIMIT(C.Structure):
    _fields_ = [("basic", BASICLIMIT), ("io", C.c_uint64 * 6),
                ("process_memory", SIZE), ("job_memory", SIZE), ("peak_process", SIZE), ("peak_job", SIZE)]

K.CreateJobObjectW.argtypes = [C.c_void_p, W.LPCWSTR]; K.CreateJobObjectW.restype = W.HANDLE
K.SetInformationJobObject.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]; K.SetInformationJobObject.restype = W.BOOL
K.CreateProcessW.argtypes = [W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p, W.BOOL, W.DWORD, C.c_void_p, W.LPCWSTR, C.POINTER(STARTUPINFO), C.POINTER(PROCESSINFO)]
K.CreateProcessW.restype = W.BOOL
K.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]; K.AssignProcessToJobObject.restype = W.BOOL
K.ResumeThread.argtypes = [W.HANDLE]; K.ResumeThread.restype = W.DWORD
K.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]; K.WaitForSingleObject.restype = W.DWORD
K.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]; K.TerminateJobObject.restype = W.BOOL
K.TerminateProcess.argtypes = [W.HANDLE, W.UINT]; K.TerminateProcess.restype = W.BOOL
K.CloseHandle.argtypes = [W.HANDLE]; K.CloseHandle.restype = W.BOOL
K.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]; K.OpenProcess.restype = W.HANDLE
K.IsProcessInJob.argtypes = [W.HANDLE, W.HANDLE, C.POINTER(W.BOOL)]; K.IsProcessInJob.restype = W.BOOL
U.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]; U.GetWindowThreadProcessId.restype = W.DWORD
U.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]; U.PostMessageW.restype = W.BOOL
ENUM = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
U.EnumWindows.argtypes = [ENUM, W.LPARAM]; U.EnumWindows.restype = W.BOOL

def checked(ok):
    if not ok:
        raise C.WinError(C.get_last_error())

class OwnedProcess:
    def __init__(self, executable, arguments, environment, cwd, *, kill_on_controller_exit):
        self.job = K.CreateJobObjectW(None, None); checked(self.job)
        self.process = None; self.pid = None
        info = PROCESSINFO()
        try:
            limits = EXTENDEDLIMIT()
            limits.basic.flags = 0x2000 if kill_on_controller_exit else 0  # KILL_ON_JOB_CLOSE
            checked(K.SetInformationJobObject(self.job, 9, C.byref(limits), C.sizeof(limits)))
            command = C.create_unicode_buffer(subprocess.list2cmdline([str(executable), *arguments]))
            block = C.create_unicode_buffer("\0".join(f"{k}={v}" for k, v in sorted(environment.items(), key=lambda p: p[0].upper())) + "\0\0")
            startup = STARTUPINFO(); startup.cb = C.sizeof(startup)
            # Suspend before assigning the job: no WebView2 child can escape it.
            checked(K.CreateProcessW(str(executable), command, None, None, False,
                                    0x4 | 0x400 | 0x08000000, block, str(cwd), C.byref(startup), C.byref(info)))
            self.process = info.process; self.pid = info.pid
            checked(K.AssignProcessToJobObject(self.job, self.process))
            if K.ResumeThread(info.thread) == 0xFFFFFFFF:
                checked(False)
        except BaseException:
            if info.process:
                K.TerminateProcess(info.process, 1); K.CloseHandle(info.process)
            K.CloseHandle(self.job); self.job = None; self.process = None
            raise
        finally:
            if info.thread:
                K.CloseHandle(info.thread)

    def contains(self, pid):
        process = K.OpenProcess(0x1000, False, pid)
        if not process:
            return False
        try:
            result = W.BOOL()
            return bool(K.IsProcessInJob(process, self.job, C.byref(result)) and result.value)
        finally:
            K.CloseHandle(process)

    def stop(self):
        if not self.process:
            return
        @ENUM
        def close_window(hwnd, _):
            pid = W.DWORD(); U.GetWindowThreadProcessId(hwnd, C.byref(pid))
            if pid.value == self.pid:
                U.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE: app saves its session.
            return True
        if K.WaitForSingleObject(self.process, 0) == 0x102:
            U.EnumWindows(close_window, 0)
            K.WaitForSingleObject(self.process, 8000)
        # Only this owned job tree; never kill arbitrary app.exe processes.
        K.TerminateJobObject(self.job, 0)
        K.CloseHandle(self.process); K.CloseHandle(self.job)
        self.process = self.job = None

    def __del__(self):
        # Normal jobs have no KILL_ON_JOB_CLOSE: normal UI can outlive controller.
        for handle in (getattr(self, "process", None), getattr(self, "job", None)):
            if handle:
                K.CloseHandle(handle)
