// Read-only Windows Portable Devices bridge. Interface order follows Windows SDK 10 PortableDeviceApi.idl.
// No remote create/delete/move operations are exposed. Every process owns and releases its COM session.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Web.Script.Serialization;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
struct Key { public Guid Format; public uint Id; public Key(string format, uint id) { Format = new Guid(format); Id = id; } }
[ComImport, Guid("a1567595-4c2f-4574-a6fa-ecef917b9a40"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface Manager {
    void GetDevices(IntPtr ids, ref uint count);
    void RefreshDeviceList();
    void GetDeviceFriendlyName([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, ref uint count);
}
[ComImport, Guid("625e2df8-6392-4cf0-9ad1-3cfa5f17775c"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface Device {
    void Open([MarshalAs(UnmanagedType.LPWStr)] string id, Values client);
    void UnusedSendCommand();
    void Content(out Content content);
    void UnusedCapabilities();
    void Cancel();
    void Close();
}
[ComImport, Guid("6a96ed84-7c73-4480-9938-bf5af477d426"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface Content {
    void EnumObjects(uint flags, [MarshalAs(UnmanagedType.LPWStr)] string parent, IntPtr filter, out ObjectIds ids);
    void Properties(out Properties properties);
    void Transfer(out Resources resources);
}
[ComImport, Guid("10ece955-cf41-4728-bfa0-41eedf1bbf19"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ObjectIds {
    [PreserveSig] int Next(uint count, [Out, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr, SizeParamIndex = 0)] string[] ids, out uint fetched);
}
[ComImport, Guid("7f6d695c-03df-4439-a809-59266beee3a6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface Properties {
    void UnusedGetSupportedProperties();
    void UnusedGetPropertyAttributes();
    void GetValues([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr keys, out Values values);
}
[ComImport, Guid("fd8878ac-d841-4d17-891c-e6829cdb6934"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface Resources {
    void UnusedGetSupportedResources();
    void UnusedGetResourceAttributes();
    void GetStream([MarshalAs(UnmanagedType.LPWStr)] string id, ref Key key, uint mode, ref uint optimalSize, out IStream stream);
}
[ComImport, Guid("6848f6f2-3155-4f86-b6f5-263eeeab3143"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface Values {
    void UnusedGetCount(); void UnusedGetAt(); void UnusedSetValue(); void UnusedGetValue();
    void SetStringValue(ref Key key, [MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetStringValue(ref Key key, [MarshalAs(UnmanagedType.LPWStr)] out string value);
    void SetUnsignedIntegerValue(ref Key key, uint value);
    void GetUnsignedIntegerValue(ref Key key, out uint value);
    void UnusedSetSignedIntegerValue(); void UnusedGetSignedIntegerValue(); void UnusedSetUnsignedLargeIntegerValue();
    void GetUnsignedLargeIntegerValue(ref Key key, out ulong value);
}

class Entry { public string id; public string name; public long size; }
class WpdReader {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    static Key Name = new Key("EF6B490D-5CD8-437A-AFFC-DA8B60EE4A3C", 4);
    static Key OriginalName = new Key("EF6B490D-5CD8-437A-AFFC-DA8B60EE4A3C", 12);
    static Key Size = new Key("EF6B490D-5CD8-437A-AFFC-DA8B60EE4A3C", 11);
    static object Create(string guid) { return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(guid))); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }

    static List<Entry> Devices() {
        var manager = (Manager)Create("0af10cec-2ecd-4b92-9581-34f6ae0637f3");
        IntPtr array = IntPtr.Zero;
        var result = new List<Entry>();
        uint capacity = 0;
        try {
            manager.RefreshDeviceList();
            manager.GetDevices(IntPtr.Zero, ref capacity);
            if (capacity == 0) return result;
            if (capacity > 4096) throw new IOException("Too many portable devices");
            array = Marshal.AllocCoTaskMem(checked((int)capacity * IntPtr.Size));
            for (int i = 0; i < capacity; i++) Marshal.WriteIntPtr(array, i * IntPtr.Size, IntPtr.Zero);
            uint count = capacity;
            manager.GetDevices(array, ref count);
            for (int i = 0; i < Math.Min(count, capacity); i++) {
                string id = Marshal.PtrToStringUni(Marshal.ReadIntPtr(array, i * IntPtr.Size));
                uint chars = 1024;
                var friendly = new StringBuilder((int)chars);
                try { manager.GetDeviceFriendlyName(id, friendly, ref chars); } catch (COMException) { friendly.Append("Portable device"); }
                result.Add(new Entry { id = id, name = friendly.ToString(), size = 0 });
            }
            return result;
        } finally {
            if (array != IntPtr.Zero) {
                for (int i = 0; i < capacity; i++) { var p = Marshal.ReadIntPtr(array, i * IntPtr.Size); if (p != IntPtr.Zero) Marshal.FreeCoTaskMem(p); }
                Marshal.FreeCoTaskMem(array);
            }
            Release(manager);
        }
    }

    static List<Entry> Children(Content content, string parent) {
        ObjectIds ids = null; Properties properties = null;
        var result = new List<Entry>();
        try {
            content.EnumObjects(0, parent, IntPtr.Zero, out ids);
            content.Properties(out properties);
            while (true) {
                var batch = new string[32]; uint fetched;
                int hr = ids.Next(32, batch, out fetched);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                for (int i = 0; i < fetched; i++) {
                    Values values = null;
                    try {
                        properties.GetValues(batch[i], IntPtr.Zero, out values);
                        string name; ulong size = 0;
                        try { values.GetStringValue(ref OriginalName, out name); }
                        catch (COMException) { values.GetStringValue(ref Name, out name); }
                        try { values.GetUnsignedLargeIntegerValue(ref Size, out size); } catch (COMException) { }
                        result.Add(new Entry { id = batch[i], name = name, size = checked((long)size) });
                        if (result.Count > 100000) throw new IOException("Too many objects in this folder");
                    } finally { Release(values); }
                }
                if (fetched == 0 || hr == 1) break;
            }
        } finally { Release(properties); Release(ids); }
        return result;
    }

    static List<Entry> Sessions(Content content) {
        var files = new List<Entry>();
        var storage = Children(content, "DEVICE");
        if (storage.Count == 0) throw new IOException("Phone storage is unavailable. Unlock the phone and select File transfer.");
        bool found = false;
        foreach (var root in storage) {
            var current = root;
            foreach (var part in new[] { "Download", "ApexDrive", "Telemetry" }) {
                current = Children(content, current.id).FirstOrDefault(x => String.Equals(x.name, part, StringComparison.OrdinalIgnoreCase));
                if (current == null) break;
            }
            if (current != null) { found = true; files.AddRange(Children(content, current.id)); }
        }
        if (!found) {
            var rootNames = string.Join(", ", storage.Select(x => x.name).Where(x => !string.IsNullOrWhiteSpace(x)));
            if (storage.Any(x => string.Equals(x.name, "DCIM", StringComparison.OrdinalIgnoreCase)) ||
                storage.Any(x => string.Equals(x.name, "Pictures", StringComparison.OrdinalIgnoreCase))) {
                throw new IOException("The phone is using Photo transfer (PTP), which exposes only photos. On the phone choose USB mode File transfer / Android Auto, keep it unlocked, and wait for Internal storage to appear in Windows. Then run Sync again.");
            }
            throw new IOException(string.Format("Download/ApexDrive/Telemetry was not found. Finish a ride and open ApexDrive to publish saved sessions. Visible phone storage: {0}", rootNames));
        }
        return files;
    }

    static void Read(Content content, string id) {
        Resources resources = null; IStream stream = null;
        IntPtr read = Marshal.AllocCoTaskMem(4);
        try {
            content.Transfer(out resources);
            var key = new Key("E81E79BE-34F0-41BF-B53F-F1A06AE87842", 0);
            uint optimal = 65536;
            resources.GetStream(id, ref key, 0 /* STGM_READ */, ref optimal, out stream);
            var buffer = new byte[65536];
            using (var output = Console.OpenStandardOutput()) {
                while (true) {
                    Marshal.WriteInt32(read, 0);
                    stream.Read(buffer, buffer.Length, read);
                    int count = Marshal.ReadInt32(read);
                    if (count == 0) break;
                    output.Write(buffer, 0, count);
                }
                output.Flush();
            }
        } finally { Release(stream); Release(resources); Marshal.FreeCoTaskMem(read); }
    }

    [STAThread] static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        Device device = null; Content content = null; Values client = null;
        try {
            if (args.Length == 1 && args[0] == "devices") { Console.Write(Json.Serialize(Devices())); return 0; }
            if (args.Length < 2 || (args[0] != "list" && args[0] != "read")) throw new ArgumentException("Expected devices, list or read");
            device = (Device)Create("728a21c5-3d9e-48d7-9810-864848f0f404");
            client = (Values)Create("0c15d503-d017-47ce-9016-7b3f978721cc");
            var access = new Key("204D9F0C-2292-4080-9F42-40664E70F859", 9);
            client.SetUnsignedIntegerValue(ref access, 0x80000000 /* GENERIC_READ */);
            device.Open(args[1], client);
            device.Content(out content);
            if (args[0] == "list") Console.Write(Json.Serialize(Sessions(content)));
            else { if (args.Length != 3) throw new ArgumentException("Missing object ID"); Read(content, args[2]); }
            return 0;
        } catch (Exception error) { Console.Error.Write(error.Message); return 1; }
        finally { Release(content); if (device != null) { try { device.Close(); } catch { } Release(device); } Release(client); }
    }
}
