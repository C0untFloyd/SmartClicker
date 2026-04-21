const ScreenshotMode = Object.freeze({
    Colored:    'Colored',
    Gray:       'Gray',
    BlackWhite: 'BlackWhite'
});

const ActionType = {
    DELAY: "delay",
    MOVE_TO_POS: "movetopos",
    MOUSE_CLICK: "mouseclick",
    WAIT_FOR_IMAGE: "waitforimage",
    MOVE_TO_IMAGE_CENTER: "movetoimagecenter",
    KEYPRESS: "keypress",
    CLICKIMAGE: "clickimage",
    MOUSE_WHEEL: "mousewheel",
    CLICKIMAGE_WHILE_FOUND: "clickimagewhilefound",
    WRITETEXT: "writetext",
    NUMBERED_LOOP: "numberedloop",
    WHILE_CONDITION_LOOP: "whileconditionloop",
    GROUP: "group"
};

const LoopType = {
    FIXED_ITERATIONS: "fixedIterations",
    INFINITE: "infinite"
};

class LoopSpecification {
    constructor(data = {}) {
        this.type = data.type || LoopType.FIXED_ITERATIONS;
        this.iterations = data.iterations || 0;
        this.delayBetweenIterations_ms = data.delayBetweenIterations_ms || 0;
    }

    toDict() {
        return {
            type: this.type,
            iterations: this.iterations,
            delayBetweenIterations_ms: this.delayBetweenIterations_ms
        };
    }
}

class ActionBase {
    constructor(actionType, data = {}) {
        this.actionType = actionType;
        this.enabled = data.enabled !== undefined ? data.enabled : true;
        this.childActions = data.childActions ? data.childActions.map(a => actionFromDict(a)) : null;
    }

    toDict() {
        const result = {
            actionType: this.actionType,
            enabled: this.enabled
        };
        if (this.childActions) {
            result.childActions = this.childActions.map(a => a.toDict());
        }
        return result;
    }
}

class DelayAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.DELAY, data);
        this.duration_ms = data.duration_ms || 0;
    }

    toDict() {
        return { ...super.toDict(), duration_ms: this.duration_ms };
    }
}

class MoveToPosAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.MOVE_TO_POS, data);
        this.x = data.x || 0;
        this.y = data.y || 0;
        this.speed = data.speed || "medium";
    }

    toDict() {
        return { ...super.toDict(), x: this.x, y: this.y, speed: this.speed };
    }
}

class MouseClickAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.MOUSE_CLICK, data);
        this.button = data.button || "left";
        this.x = data.x || 0;
        this.y = data.y || 0;
        this.holdTime_ms = data.holdTime_ms || 0;
    }

    toDict() {
        return { ...super.toDict(), button: this.button, x: this.x, y: this.y, holdTime_ms: this.holdTime_ms };
    }
}

class MouseWheelAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.MOUSE_WHEEL, data);
        this.wheel_amount = data.wheel_amount || 0;
    }

    toDict() {
        return { ...super.toDict(), wheel_amount: this.wheel_amount };
    }
}

class KeypressAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.KEYPRESS, data);
        this.key = data.key || "";
        this.modifier = data.modifier || "none";
    }

    toDict() {
        return { ...super.toDict(), key: this.key, modifier: this.modifier };
    }
}

class WriteTextAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.WRITETEXT, data);
        this.text = data.text || "";
    }

    toDict() {
        return { ...super.toDict(), text: this.text };
    }
}

class ImageActionBase extends ActionBase {
    constructor(actionType, data = {}) {
        super(actionType, data);
        this.imagePath = Array.isArray(data.imagePath) ? data.imagePath : (data.imagePath ? [data.imagePath] : []);
        this.screenshotMode = Object.values(ScreenshotMode).includes(data.screenshotMode)
            ? data.screenshotMode
            : ScreenshotMode.Colored;
        this.threshold = Number.isFinite(Number(data.threshold))
            ? Math.max(1, Math.min(254, Number(data.threshold)))
            : 128;
    }

    toDict() {
        const result = { ...super.toDict(), imagePath: this.imagePath, screenshotMode: this.screenshotMode };
        // Keep threshold optional in serialized scripts, while still defaulting to 128 in memory.
        if (this.threshold !== 128) result.threshold = this.threshold;
        return result;
    }
}

class WaitForImageAction extends ImageActionBase {
    constructor(data = {}) {
        super(ActionType.WAIT_FOR_IMAGE, data);
        this.timeout_ms = data.timeout_ms || 0;
        this.tolerance = data.tolerance || 0.0;
    }

    toDict() {
        return { ...super.toDict(), timeout_ms: this.timeout_ms, tolerance: this.tolerance };
    }
}

class MoveToImageCenterAction extends ImageActionBase {
    constructor(data = {}) {
        super(ActionType.MOVE_TO_IMAGE_CENTER, data);
        this.offset_x = data.offset_x || 0;
        this.offset_y = data.offset_y || 0;
    }

    toDict() {
        return { ...super.toDict(), offset_x: this.offset_x, offset_y: this.offset_y };
    }
}

class ClickImageAction extends ImageActionBase {
    constructor(data = {}) {
        super(ActionType.CLICKIMAGE, data);
        this.holdTime_ms = data.holdTime_ms || 0;
    }

    toDict() {
        return { ...super.toDict(), holdTime_ms: this.holdTime_ms };
    }
}

class ClickImageWhileFoundAction extends ImageActionBase {
    constructor(data = {}) {
        super(ActionType.CLICKIMAGE_WHILE_FOUND, data);
        this.holdTime_ms = data.holdTime_ms || 0;
    }

    toDict() {
        return { ...super.toDict(), holdTime_ms: this.holdTime_ms };
    }
}

class NumberedLoopAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.NUMBERED_LOOP, data);
        this.iterations = data.iterations || 1;
        this.delayBetweenIterations_ms = data.delayBetweenIterations_ms || 0;
    }

    toDict() {
        return { ...super.toDict(), iterations: this.iterations, delayBetweenIterations_ms: this.delayBetweenIterations_ms };
    }
}

class WhileConditionLoopAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.WHILE_CONDITION_LOOP, data);
        this.conditionType = data.conditionType || "imagepresent";
        this.conditionValue = data.conditionValue || "";
        this.timeout_ms = data.timeout_ms || 0;
        this.tolerance = data.tolerance || 0.0;
        this.modifier = data.modifier || "none";
        this.screenshotMode = Object.values(ScreenshotMode).includes(data.screenshotMode)
            ? data.screenshotMode
            : ScreenshotMode.Colored;
        this.threshold = Number.isFinite(Number(data.threshold))
            ? Math.max(1, Math.min(254, Number(data.threshold)))
            : 128;
    }

    toDict() {
        const result = {
            ...super.toDict(),
            conditionType: this.conditionType,
            conditionValue: this.conditionValue,
            timeout_ms: this.timeout_ms,
            tolerance: this.tolerance,
            modifier: this.modifier,
            screenshotMode: this.screenshotMode
        };
        if (this.threshold !== 128) result.threshold = this.threshold;
        return result;
    }
}

class GroupAction extends ActionBase {
    constructor(data = {}) {
        super(ActionType.GROUP, data);
        this.groupName = data.groupName || "Group";
    }

    toDict() {
        return { ...super.toDict(), groupName: this.groupName };
    }
}

function actionFromDict(data) {
    switch (data.actionType) {
        case ActionType.DELAY: return new DelayAction(data);
        case ActionType.MOVE_TO_POS: return new MoveToPosAction(data);
        case ActionType.MOUSE_CLICK: return new MouseClickAction(data);
        case ActionType.MOUSE_WHEEL: return new MouseWheelAction(data);
        case ActionType.KEYPRESS: return new KeypressAction(data);
        case ActionType.WRITETEXT: return new WriteTextAction(data);
        case ActionType.CLICKIMAGE: return new ClickImageAction(data);
        case ActionType.CLICKIMAGE_WHILE_FOUND: return new ClickImageWhileFoundAction(data);
        case ActionType.WAIT_FOR_IMAGE: return new WaitForImageAction(data);
        case ActionType.MOVE_TO_IMAGE_CENTER: return new MoveToImageCenterAction(data);
        case ActionType.NUMBERED_LOOP: return new NumberedLoopAction(data);
        case ActionType.WHILE_CONDITION_LOOP: return new WhileConditionLoopAction(data);
        case ActionType.GROUP: return new GroupAction(data);
        default: throw new Error("Unsupported action type: " + data.actionType);
    }
}

class AutomationScript {
    constructor(data = {}) {
        this.scriptName = data.scriptName || "";
        this.description = data.description || "";
        this.loopSpecification = new LoopSpecification(data.loopSpecification || {});
        this.actions = (data.actions || []).map(a => actionFromDict(a));
    }

    toDict() {
        return {
            scriptName: this.scriptName,
            description: this.description,
            loopSpecification: this.loopSpecification.toDict(),
            actions: this.actions.map(a => a.toDict())
        };
    }
}

export {
    ScreenshotMode,
    ActionType,
    LoopType,
    LoopSpecification,
    DelayAction,
    MoveToPosAction,
    MouseClickAction,
    MouseWheelAction,
    KeypressAction,
    WriteTextAction,
    WaitForImageAction,
    MoveToImageCenterAction,
    ClickImageAction,
    ClickImageWhileFoundAction,
    NumberedLoopAction,
    WhileConditionLoopAction,
    GroupAction,
    AutomationScript,
    actionFromDict
};
