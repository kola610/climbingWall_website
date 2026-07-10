"""Decisive LOCAL open test with zero other holders; writes result to file."""
import traceback
from Phidget22.Devices.VoltageRatioInput import VoltageRatioInput
from Phidget22.PhidgetException import PhidgetException

v = VoltageRatioInput()
v.setDeviceSerialNumber(293701)
v.setChannel(0)
lines = []
try:
    v.openWaitForAttachment(6000)
    lines.append("ATTACHED ratio=%r" % v.getVoltageRatio())
except PhidgetException as e:
    lines.append("code=%s details=%s" % (e.code, str(e.details)[:200]))
except Exception as e:
    lines.append("other: %r\n%s" % (e, traceback.format_exc()))
with open("/tmp/phidget_terminal_test.txt", "w") as f:
    f.write("\n".join(str(x) for x in lines) + "\n")
try:
    v.close()
except Exception:
    pass
