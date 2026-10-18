#include "../js_modules.h"

#include <core/common_defines.h>
#include <power/power_service/power.h>

static void js_power_get_info(PowerInfo* info) {
    Power* power = furi_record_open(RECORD_POWER);

    power_get_info(power, info);

    furi_record_close(RECORD_POWER);
}

static void js_power_is_usb_powered(struct mjs* mjs) {
    PowerInfo info;
    js_power_get_info(&info);

    /*
     * voltage_vbus is 0 when external USB VBUS is absent.
     *
     * This is deliberately NOT based on is_charging:
     * a fully charged Flipper may be externally powered
     * while no longer actively charging.
     */
    bool powered = info.voltage_vbus > 0.0f;

    mjs_return(mjs, mjs_mk_boolean(mjs, powered));
}

static void js_power_usb_voltage(struct mjs* mjs) {
    PowerInfo info;
    js_power_get_info(&info);

    mjs_return(mjs, mjs_mk_number(mjs, info.voltage_vbus));
}

static void js_power_is_charging(struct mjs* mjs) {
    PowerInfo info;
    js_power_get_info(&info);

    mjs_return(mjs, mjs_mk_boolean(mjs, info.is_charging));
}

static void* js_power_create(
    struct mjs* mjs,
    mjs_val_t* object,
    JsModules* modules) {

    UNUSED(modules);

    mjs_val_t power_obj = mjs_mk_object(mjs);

    JS_ASSIGN_MULTI(mjs, power_obj) {
        JS_FIELD(
            "isUsbPowered",
            MJS_MK_FN(js_power_is_usb_powered));

        JS_FIELD(
            "usbVoltage",
            MJS_MK_FN(js_power_usb_voltage));

        JS_FIELD(
            "isCharging",
            MJS_MK_FN(js_power_is_charging));
    }

    *object = power_obj;

    return (void*)1;
}

static void js_power_destroy(void* inst) {
    UNUSED(inst);
}

static const JsModuleDescriptor js_power_desc = {
    "power",
    js_power_create,
    js_power_destroy,
    NULL,
};

static const FlipperAppPluginDescriptor plugin_descriptor = {
    .appid = PLUGIN_APP_ID,
    .ep_api_version = PLUGIN_API_VERSION,
    .entry_point = &js_power_desc,
};

const FlipperAppPluginDescriptor* js_power_ep(void) {
    return &plugin_descriptor;
}
