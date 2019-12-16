/**
 * A screen that contains all the available servives.
 * - Local tab: services sections related to the areas of interest selected by the user
 * - National tab: national services sections
 * - All: local and national services sections, not including the user areas of interest
 *
 * A 'loading component' is displayed (hiding the tabs content) if:
 * - visible services are loading, or
 * - userMetadata are loading
 *
 * An 'error component' is displayed (hiding the tabs content) if:
 * - userMetadata load fails, or
 * - visible services load fails
 *
 * A loader on tabs is displayed (not hiding the tabs content) if:
 * - userMetadata is updating, or
 * - visible services are refreshed
 *
 * If toastContent is undefined, when userMetadata/visible services are loading/error,
 * tabs are hidden and they are displayed renderServiceLoadingPlaceholder/renderErrorPlaceholder
 *
 * TODO: fix graphycal issues at potUserMetadata or services refresh
 *       - https://www.pivotaltracker.com/story/show/169224363s
 *       - https://www.pivotaltracker.com/story/show/169262311
 */
import { Option } from "fp-ts/lib/Option";
import * as pot from "italia-ts-commons/lib/pot";
import { Tab, Tabs, Text, View } from "native-base";
import * as React from "react";
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet
} from "react-native";
import {
  NavigationEventSubscription,
  NavigationScreenProps
} from "react-navigation";
import { connect } from "react-redux";
import { ServicePublic } from "../../../definitions/backend/ServicePublic";
import ButtonDefaultOpacity from "../../components/ButtonDefaultOpacity";
import { withLightModalContext } from "../../components/helpers/withLightModalContext";
import GenericErrorComponent from "../../components/screens/GenericErrorComponent";
import { ScreenContentHeader } from "../../components/screens/ScreenContentHeader";
import TopScreenComponent from "../../components/screens/TopScreenComponent";
import { MIN_CHARACTER_SEARCH_TEXT } from "../../components/search/SearchButton";
import { SearchNoResultMessage } from "../../components/search/SearchNoResultMessage";
import ServicesSearch from "../../components/services/ServicesSearch";
import ServicesTab from "../../components/services/ServicesTab";
import { LightModalContextInterface } from "../../components/ui/LightModal";
import Markdown from "../../components/ui/Markdown";
import I18n from "../../i18n";
import { navigateToServiceDetailsScreen } from "../../store/actions/navigation";
import { serviceAlertDisplayedOnceSuccess } from "../../store/actions/persistedPreferences";
import { profileUpsert } from "../../store/actions/profile";
import {
  loadVisibleServices,
  showServiceDetails
} from "../../store/actions/services";
import { Dispatch } from "../../store/actions/types";
import {
  userMetadataLoad,
  userMetadataUpsert
} from "../../store/actions/userMetadata";
import {
  nationalServicesSectionsSelector,
  notSelectedServicesSectionsSelector,
  selectedLocalServicesSectionsSelector,
  ServicesSectionState,
  visibleServicesContentLoadStateSelector,
  visibleServicesMetadataLoadStateSelector
} from "../../store/reducers/entities/services";
import { readServicesByIdSelector } from "../../store/reducers/entities/services/readStateByServiceId";
import { servicesByIdSelector } from "../../store/reducers/entities/services/servicesById";
import { visibleServicesSelector } from "../../store/reducers/entities/services/visibleServices";
import { wasServiceAlertDisplayedOnceSelector } from "../../store/reducers/persistedPreferences";
import { profileSelector, ProfileState } from "../../store/reducers/profile";
import {
  isSearchServicesEnabledSelector,
  searchTextSelector
} from "../../store/reducers/search";
import { GlobalState } from "../../store/reducers/types";
import {
  UserMetadata,
  userMetadataSelector
} from "../../store/reducers/userMetadata";
import { makeFontStyleObject } from "../../theme/fonts";
import customVariables from "../../theme/variables";
import { InferNavigationParams } from "../../types/react";
import { HEADER_HEIGHT } from "../../utils/constants";
import {
  getChannelsforServicesList,
  getProfileChannelsforServicesList
} from "../../utils/profile";
import { showToast } from "../../utils/showToast";
import { setStatusBarColorAndBackground } from "../../utils/statusBar";
import ServiceDetailsScreen from "./ServiceDetailsScreen";

type OwnProps = NavigationScreenProps;

type ReduxMergedProps = Readonly<{
  updateOrganizationsOfInterestMetadata: (
    selectedItemIds: Option<Set<string>>
  ) => void;
}>;

type Props = ReturnType<typeof mapStateToProps> &
  ReturnType<typeof mapDispatchToProps> &
  OwnProps &
  ReduxMergedProps &
  LightModalContextInterface;

type State = {
  currentTab: number;
  currentTabServicesId: ReadonlyArray<string>;
  enableHeaderAnimation: boolean;
  isLongPressEnabled: boolean;
  enableServices: boolean;
  toastErrorMessage: string;
  isInnerContentRendered: boolean;
  isUpdating: boolean;
  isButtonUpdating: boolean;
};

type DataLoadFailure =
  | "servicesLoadFailure"
  | "userMetadaLoadFailure"
  | undefined;

const EMPTY_MESSAGE = "";

// Scroll range is directly influenced by floating header height
const SCROLL_RANGE_FOR_ANIMATION = HEADER_HEIGHT;

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  topScreenContainer: {
    flex: 1,
    justifyContent: "flex-end"
  },
  tabBarContainer: {
    elevation: 0,
    height: 40
  },
  tabBarContent: {
    fontSize: customVariables.fontSizeSmall
  },
  tabBarUnderline: {
    borderBottomColor: customVariables.tabUnderlineColor,
    borderBottomWidth: customVariables.tabUnderlineHeight
  },
  tabBarUnderlineActive: {
    height: customVariables.tabUnderlineHeight,
    // borders do not overlap eachother, but stack naturally
    marginBottom: -customVariables.tabUnderlineHeight,
    backgroundColor: customVariables.contentPrimaryBackground
  },
  searchDisableIcon: {
    color: customVariables.headerFontColor
  },
  organizationLogo: {
    marginBottom: 0
  },
  activeTextStyle: {
    ...makeFontStyleObject(Platform.select, "600"),
    fontSize: Platform.OS === "android" ? 16 : undefined,
    fontWeight: Platform.OS === "android" ? "normal" : "bold",
    color: customVariables.brandPrimary
  },
  textStyle: {
    color: customVariables.brandDarkGray,
    fontSize: customVariables.fontSizeSmall
  },
  center: {
    alignItems: "center"
  },
  padded: {
    paddingHorizontal: customVariables.contentPadding
  },
  customSpacer: {
    height: customVariables.spacerHeight + customVariables.h1LineHeight
  },
  errorText: {
    fontSize: customVariables.fontSize2,
    paddingTop: customVariables.contentPadding
  },
  errorText2: {
    fontSize: customVariables.fontSizeSmall
  },
  varBar: {
    flexDirection: "row",
    zIndex: 1,
    justifyContent: "space-around",
    backgroundColor: customVariables.colorWhite,
    padding: 10
  },
  buttonBar: {
    flex: 2,
    marginEnd: 5
  }
});

const AnimatedTabs = Animated.createAnimatedComponent(Tabs);

class ServicesHomeScreen extends React.Component<Props, State> {
  private navListener?: NavigationEventSubscription;

  constructor(props: Props) {
    super(props);
    this.state = {
      currentTab: 0,
      currentTabServicesId: [],
      enableHeaderAnimation: false,
      isLongPressEnabled: false,
      enableServices: false,
      toastErrorMessage: EMPTY_MESSAGE,
      isInnerContentRendered: false,
      isUpdating: false,
      isButtonUpdating: false
    };
  }
  /**
   * return true if all services have INBOX channel disabled
   */
  private areAllServicesInboxChannelDisabled = (): boolean => {
    const currentTabServicesChannels = this.props.getServicesChannels(
      this.props.tabsServicesId[this.state.currentTab],
      this.props.profile
    );

    const disabledServices: number = Object.keys(
      currentTabServicesChannels
    ).filter(id => currentTabServicesChannels[id].indexOf("INBOX") !== -1)
      .length;

    return disabledServices === Object.keys(currentTabServicesChannels).length;
  };

  private handleOnLongPressItem = () => {
    if (!this.props.isSearchEnabled) {
      const enableServices = this.areAllServicesInboxChannelDisabled();
      const isLongPressEnabled = !this.state.isLongPressEnabled;
      const currentTabServicesId = this.props.tabsServicesId[
        this.state.currentTab
      ];
      this.setState({
        isLongPressEnabled,
        currentTabServicesId,
        enableServices
      });
    }
  };

  /**
   * if we are displaying the loading screen and we got no errors on loading
   * data, then we can show the content
   */
  private canRenderContent = () => {
    if (
      !this.state.isInnerContentRendered &&
      this.props.isFirstServiceLoadCompleted &&
      this.props.loadDataFailure === undefined
    ) {
      this.setState({ isInnerContentRendered: true });
    }
  };

  public componentDidMount() {
    // On mount, update visible services and user metadata if their
    // refresh fails
    if (pot.isError(this.props.potUserMetadata)) {
      this.props.refreshUserMetadata();
    }

    this.canRenderContent();

    if (
      pot.isError(this.props.visibleServicesContentLoadState) ||
      pot.isError(this.props.visibleServicesMetadataLoadState)
    ) {
      this.props.refreshServices();
    }

    this.navListener = this.props.navigation.addListener("didFocus", () => {
      setStatusBarColorAndBackground(
        "dark-content",
        customVariables.colorWhite
      );
    }); // tslint:disable-line no-object-mutation
  }

  private animatedScrollPositions: ReadonlyArray<Animated.Value> = [
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0)
  ];

  // tslint:disable-next-line: readonly-array
  private scollPositions: number[] = [0, 0, 0];

  // TODO: evaluate if it can be replaced by the component introduced within https://www.pivotaltracker.com/story/show/168247501
  private renderServiceLoadingPlaceholder() {
    return (
      <View style={[styles.center, styles.padded]}>
        {Platform.OS === "ios" && <View style={styles.customSpacer} />}
        <View spacer={true} extralarge={true} />
        <View spacer={true} extralarge={true} />
        <Image
          source={require("../../../img/services/icon-loading-services.png")}
        />
        <View spacer={true} extralarge={true} />
        <Text bold={true}>{I18n.t("services.loading.title")}</Text>
        <Text>{I18n.t("services.loading.subtitle")}</Text>
      </View>
    );
  }

  // tslint:disable-next-line: cognitive-complexity
  public componentDidUpdate(prevProps: Props, prevState: State) {
    // if some errors occur while updating profile, we will show a message in a toast
    // profile could be updated by enabling/disabling on or more channel of a service
    if (pot.isError(this.props.profile) && !pot.isError(prevProps.profile)) {
      showToast(
        I18n.t("serviceDetail.onUpdateEnabledChannelsFailure"),
        "danger"
      );
    }

    const enableServices = this.areAllServicesInboxChannelDisabled();
    if (enableServices !== prevState.enableServices) {
      this.setState({ enableServices });
    }
    // saving current list scroll position to enable header animation
    // when shifting between tabs
    if (prevState.currentTab !== this.state.currentTab) {
      this.animatedScrollPositions.map((__, i) => {
        // when current tab changes, listeners are not kept, so it is needed to
        // assign them again.
        this.animatedScrollPositions[i].removeAllListeners();
        this.animatedScrollPositions[i].addListener(animatedValue => {
          // tslint:disable-next-line: no-object-mutation
          this.scollPositions[i] = animatedValue.value;
        });
      });
    }

    this.canRenderContent();

    if (this.state.isInnerContentRendered) {
      if (
        pot.isError(this.props.potUserMetadata) &&
        (pot.isUpdating(prevProps.potUserMetadata) ||
          pot.isLoading(prevProps.potUserMetadata))
      ) {
        // A toast is displayed if upsert userMetadata load fails
        showToast(this.state.toastErrorMessage, "danger");
      }

      if (
        (pot.isLoading(prevProps.visibleServicesContentLoadState) &&
          pot.isError(this.props.visibleServicesContentLoadState)) ||
        (pot.isLoading(prevProps.visibleServicesMetadataLoadState) &&
          pot.isError(this.props.visibleServicesMetadataLoadState))
      ) {
        // A toast is displayed if refresh visible services fails (on content or metadata load)
        showToast(this.state.toastErrorMessage, "danger");
      }
    }

    if (
      !prevState.enableHeaderAnimation &&
      !this.props.isLoadingServices &&
      !this.state.isUpdating
    ) {
      this.setState({ enableHeaderAnimation: true });
    }
  }

  private onServiceSelect = (service: ServicePublic) => {
    // when a service gets selected the service is recorded as read
    this.props.serviceDetailsLoad(service);
    this.props.navigateToServiceDetailsScreen({
      service
    });
  };

  private showAlertOnDisableServices = (
    title: string,
    msg: string,
    onConfirmPress: () => void
  ) => {
    Alert.alert(
      title,
      msg,
      [
        {
          text: I18n.t("global.buttons.cancel"),
          style: "cancel"
        },
        {
          text: I18n.t("global.buttons.ok"),
          style: "destructive",
          onPress: () => {
            onConfirmPress();
            // update the persisted preferences to remember the user read the alert
            this.props.updatePersistedPreference(true);
          }
        }
      ],
      { cancelable: false }
    );
  };

  private onItemSwitchValueChanged = (
    service: ServicePublic,
    value: boolean
  ) => {
    // check if the alert of disable service has not been shown already and if the service is active
    if (!this.props.wasServiceAlertDisplayedOnce && !value) {
      this.showAlertOnDisableServices(
        I18n.t("serviceDetail.disableTitle"),
        I18n.t("serviceDetail.disableMsg"),
        () => {
          this.props.disableOrEnableServices(
            [service.service_id],
            this.props.profile,
            false
          );
        }
      );
    } else {
      this.props.disableOrEnableServices(
        [service.service_id],
        this.props.profile,
        value
      );
    }
    const enableServices = this.areAllServicesInboxChannelDisabled();
    this.setState({ enableServices });
  };

  public componentWillUnmount() {
    if (this.navListener) {
      this.navListener.remove();
    }
  }

  // This method enable or disable services and update the enableServices props
  private disableOrEnableTabServices = () => {
    const { profile } = this.props;
    if (pot.isUpdating(profile)) {
      return;
    }
    const { currentTabServicesId, enableServices } = this.state;
    this.props.disableOrEnableServices(
      currentTabServicesId,
      profile,
      enableServices
    );
    this.setState({ enableServices: !enableServices });
  };

  private renderLongPressFooterButtons = () => {
    return (
      <View style={styles.varBar}>
        <ButtonDefaultOpacity
          block={true}
          bordered={true}
          onPress={this.handleOnLongPressItem}
          style={styles.buttonBar}
        >
          <Text>{I18n.t("services.close")}</Text>
        </ButtonDefaultOpacity>
        <ButtonDefaultOpacity
          block={true}
          primary={true}
          style={styles.buttonBar}
          onPress={() => {
            if (!this.props.wasServiceAlertDisplayedOnce) {
              this.showAlertOnDisableServices(
                I18n.t("services.disableAllTitle"),
                I18n.t("services.disableAllMsg"),
                () => this.disableOrEnableTabServices()
              );
            } else {
              this.disableOrEnableTabServices();
            }
          }}
        >
          <Text>
            {this.state.enableServices
              ? I18n.t("services.enableAll")
              : I18n.t("services.disableAll")}
          </Text>
        </ButtonDefaultOpacity>
      </View>
    );
  };

  private renderErrorContent = () => {
    if (this.state.isInnerContentRendered) {
      return undefined;
    }

    switch (this.props.loadDataFailure) {
      case "userMetadaLoadFailure":
        return (
          <GenericErrorComponent
            onRetry={() => this.refreshScreenContent(true)}
          />
        );
      case "servicesLoadFailure":
        return <GenericErrorComponent onRetry={this.refreshScreenContent} />;
      default:
        return undefined;
    }
  };

  private renderInnerContent = () => {
    if (this.state.isInnerContentRendered) {
      return this.renderTabs();
    } else {
      return this.renderServiceLoadingPlaceholder();
    }
  };

  public render() {
    const { userMetadata } = this.props;

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        enabled={true}
        style={styles.container}
      >
        <View style={styles.topScreenContainer}>
          <TopScreenComponent
            title={I18n.t("services.title")}
            appLogo={true}
            contextualHelp={{
              title: I18n.t("services.title"),
              body: () => <Markdown>{I18n.t("services.servicesHelp")}</Markdown>
            }}
            isSearchAvailable={userMetadata !== undefined}
            searchType={"Services"}
          >
            {this.renderErrorContent() ? (
              this.renderErrorContent()
            ) : this.props.isSearchEnabled ? (
              this.renderSearch()
            ) : (
              <React.Fragment>
                <ScreenContentHeader
                  title={I18n.t("services.title")}
                  icon={require("../../../img/icons/services-icon.png")}
                  fixed={Platform.OS === "ios"}
                />
                {this.renderInnerContent()}
                {this.state.isLongPressEnabled &&
                  this.renderLongPressFooterButtons()}
              </React.Fragment>
            )}
          </TopScreenComponent>
        </View>
      </KeyboardAvoidingView>
    );
  }

  /**
   * Render ServicesSearch component.
   */
  private renderSearch = () => {
    return this.props.searchText
      .map(
        _ =>
          _.length < MIN_CHARACTER_SEARCH_TEXT ? (
            <SearchNoResultMessage errorType={"InvalidSearchBarText"} />
          ) : (
            <ServicesSearch
              sectionsState={this.props.allSections}
              profile={this.props.profile}
              onRefresh={this.refreshServices}
              navigateToServiceDetail={this.onServiceSelect}
              searchText={_}
              readServices={this.props.readServices}
            />
          )
      )
      .getOrElse(<SearchNoResultMessage errorType={"InvalidSearchBarText"} />);
  };

  private refreshServices = () => {
    this.setState({
      toastErrorMessage: I18n.t("global.genericError")
    });
    this.props.refreshServices();
  };

  private refreshScreenContent = (hideToast: boolean = false) => {
    if (!hideToast) {
      this.setState({ toastErrorMessage: I18n.t("global.genericError") });
    }
    this.props.refreshUserMetadata();
    this.props.refreshServices();
  };

  private handleOnScroll = (value: number) => {
    const { currentTab, isLongPressEnabled } = this.state;
    if (isLongPressEnabled && Math.abs(value - currentTab) > 0.5) {
      this.setState({
        isLongPressEnabled: false
      });
    }
  };

  private handleOnChangeTab = (evt: any) => {
    const { currentTab, isLongPressEnabled } = this.state;
    const nextTab: number = evt.i;
    const isSameTab = currentTab === nextTab;
    this.setState({
      currentTab: nextTab,
      enableHeaderAnimation: true,
      isLongPressEnabled: isSameTab && isLongPressEnabled
    });
  };

  /**
   * Render Locals, Nationals and Other services tabs.
   */
  // tslint:disable no-big-function
  private renderTabs = () => {
    const {
      localTabSections,
      nationalTabSections,
      allTabSections,
      potUserMetadata,
      isLoadingServices
    } = this.props;
    return (
      <AnimatedTabs
        tabContainerStyle={[styles.tabBarContainer, styles.tabBarUnderline]}
        tabBarUnderlineStyle={styles.tabBarUnderlineActive}
        onScroll={this.handleOnScroll}
        onChangeTab={this.handleOnChangeTab}
        initialPage={0}
        style={
          Platform.OS === "ios" && {
            transform: [
              {
                // enableHeaderAnimation is used to avoid unwanted refresh of
                // animation and not in updating
                translateY: this.state.enableHeaderAnimation
                  ? this.animatedScrollPositions[
                      this.state.currentTab
                    ].interpolate({
                      inputRange: [
                        0,
                        SCROLL_RANGE_FOR_ANIMATION / 2,
                        SCROLL_RANGE_FOR_ANIMATION
                      ],
                      outputRange: [
                        SCROLL_RANGE_FOR_ANIMATION,
                        SCROLL_RANGE_FOR_ANIMATION / 4,
                        0
                      ],
                      extrapolate: "clamp"
                    })
                  : SCROLL_RANGE_FOR_ANIMATION
              }
            ]
          }
        }
      >
        <Tab
          activeTextStyle={styles.activeTextStyle}
          textStyle={styles.textStyle}
          heading={I18n.t("services.tab.locals")}
        >
          <ServicesTab
            isLocal={true}
            sections={localTabSections}
            isButtonUpdating={this.state.isButtonUpdating}
            setUpdating={(isUpdating: boolean) => {
              this.setState({
                isUpdating,
                isButtonUpdating: isUpdating,
                enableHeaderAnimation: !isUpdating
              });
            }}
            isRefreshing={
              this.state.isUpdating ||
              isLoadingServices ||
              pot.isLoading(potUserMetadata) ||
              pot.isUpdating(potUserMetadata)
            }
            onRefresh={this.refreshScreenContent}
            onServiceSelect={this.onServiceSelect}
            handleOnLongPressItem={this.handleOnLongPressItem}
            isLongPressEnabled={this.state.isLongPressEnabled}
            updateOrganizationsOfInterestMetadata={
              this.props.updateOrganizationsOfInterestMetadata
            }
            updateToast={() =>
              this.setState({
                toastErrorMessage: I18n.t(
                  "serviceDetail.onUpdateEnabledChannelsFailure"
                )
              })
            }
            onItemSwitchValueChanged={this.onItemSwitchValueChanged}
            tabOffset={this.animatedScrollPositions[0]}
          />
        </Tab>
        <Tab
          activeTextStyle={styles.activeTextStyle}
          textStyle={styles.textStyle}
          heading={I18n.t("services.tab.national")}
        >
          <ServicesTab
            sections={nationalTabSections}
            isRefreshing={isLoadingServices || pot.isLoading(potUserMetadata)}
            onRefresh={this.refreshScreenContent}
            onServiceSelect={this.onServiceSelect}
            handleOnLongPressItem={this.handleOnLongPressItem}
            isLongPressEnabled={this.state.isLongPressEnabled}
            onItemSwitchValueChanged={this.onItemSwitchValueChanged}
            tabOffset={this.animatedScrollPositions[1]}
          />
        </Tab>

        <Tab
          activeTextStyle={styles.activeTextStyle}
          textStyle={styles.textStyle}
          heading={I18n.t("services.tab.all")}
        >
          <ServicesTab
            sections={allTabSections}
            isRefreshing={
              isLoadingServices ||
              pot.isLoading(potUserMetadata) ||
              pot.isUpdating(potUserMetadata)
            }
            onRefresh={this.refreshScreenContent}
            onServiceSelect={this.onServiceSelect}
            handleOnLongPressItem={this.handleOnLongPressItem}
            isLongPressEnabled={this.state.isLongPressEnabled}
            onItemSwitchValueChanged={this.onItemSwitchValueChanged}
            tabOffset={this.animatedScrollPositions[2]}
          />
        </Tab>
      </AnimatedTabs>
    );
  };
}

const mapStateToProps = (state: GlobalState) => {
  const potUserMetadata = userMetadataSelector(state);
  const userMetadata = pot.getOrElse(potUserMetadata, undefined);

  const localTabSections = selectedLocalServicesSectionsSelector(state);
  const nationalTabSections = nationalServicesSectionsSelector(state);
  const allTabSections = notSelectedServicesSectionsSelector(state);

  // All visibile services organized in sections
  const allSections: ReadonlyArray<ServicesSectionState> = [
    ...localTabSections,
    ...allTabSections
  ];

  const getTabSevicesId = (
    tabServices: ReadonlyArray<ServicesSectionState>
  ) => {
    return tabServices.reduce(
      (acc: ReadonlyArray<string>, curr: ServicesSectionState) => {
        const sectionServices = curr.data.reduce(
          (
            acc2: ReadonlyArray<string>,
            curr2: pot.Pot<ServicePublic, Error>
          ) => {
            if (pot.isSome(curr2)) {
              return [...acc2, curr2.value.service_id];
            }
            return acc2;
          },
          []
        );
        return [...acc, ...sectionServices];
      },
      []
    );
  };

  const tabsServicesId: { [k: number]: ReadonlyArray<string> } = {
    [0]: getTabSevicesId(localTabSections),
    [1]: getTabSevicesId(nationalTabSections),
    [2]: getTabSevicesId(allTabSections)
  };

  const visibleServicesContentLoadState = visibleServicesContentLoadStateSelector(
    state
  );
  const visibleServicesMetadataLoadState = visibleServicesMetadataLoadStateSelector(
    state
  );

  const isFirstServiceLoadCompleted =
    pot.isSome(visibleServicesContentLoadState) &&
    pot.isSome(visibleServicesMetadataLoadState);

  const isLoadingServices =
    pot.isLoading(visibleServicesContentLoadState) ||
    pot.isLoading(visibleServicesMetadataLoadState);

  const servicesLoadingFailure =
    !pot.isLoading(potUserMetadata) &&
    (pot.isError(visibleServicesContentLoadState) ||
      pot.isError(visibleServicesMetadataLoadState));

  const loadDataFailure: DataLoadFailure = pot.isError(potUserMetadata)
    ? "userMetadaLoadFailure"
    : servicesLoadingFailure
      ? "servicesLoadFailure"
      : undefined;

  return {
    isLoadingServices,
    isFirstServiceLoadCompleted,
    visibleServicesContentLoadState,
    visibleServicesMetadataLoadState,
    loadDataFailure,
    profile: profileSelector(state),
    visibleServices: visibleServicesSelector(state),
    readServices: readServicesByIdSelector(state),
    allSections,
    localTabSections,
    nationalTabSections,
    allTabSections,
    tabsServicesId,
    wasServiceAlertDisplayedOnce: wasServiceAlertDisplayedOnceSelector(state),
    servicesById: servicesByIdSelector(state),
    potUserMetadata,
    userMetadata,
    isSearchEnabled: isSearchServicesEnabledSelector(state),
    searchText: searchTextSelector(state)
  };
};

const mapDispatchToProps = (dispatch: Dispatch) => ({
  refreshUserMetadata: () => dispatch(userMetadataLoad.request()),
  refreshServices: () => dispatch(loadVisibleServices.request()),
  getServicesChannels: (
    servicesId: ReadonlyArray<string>,
    profile: ProfileState
  ) => getChannelsforServicesList(servicesId, profile),
  disableOrEnableServices: (
    servicesId: ReadonlyArray<string>,
    profile: ProfileState,
    enable: boolean
  ) => {
    const newBlockedChannels = getProfileChannelsforServicesList(
      servicesId,
      profile,
      enable
    );
    dispatch(
      profileUpsert.request({
        blocked_inbox_or_channels: newBlockedChannels
      })
    );
  },
  saveSelectedOrganizationItems: (
    userMetadata: UserMetadata,
    selectedItemIds: ReadonlyArray<string>
  ) => {
    const metadata = userMetadata.metadata;
    const currentVersion: number = userMetadata.version;
    dispatch(
      userMetadataUpsert.request({
        ...userMetadata,
        version: currentVersion + 1,
        metadata: {
          ...metadata,
          organizationsOfInterest: selectedItemIds
        }
      })
    );
  },
  updatePersistedPreference: (value: boolean) => {
    dispatch(
      serviceAlertDisplayedOnceSuccess({
        wasServiceAlertDisplayedOnce: value
      })
    );
  },
  navigateToServiceDetailsScreen: (
    params: InferNavigationParams<typeof ServiceDetailsScreen>
  ) => dispatch(navigateToServiceDetailsScreen(params)),
  serviceDetailsLoad: (service: ServicePublic) =>
    dispatch(showServiceDetails(service))
});

const mergeProps = (
  stateProps: ReturnType<typeof mapStateToProps>,
  dispatchProps: ReturnType<typeof mapDispatchToProps>,
  ownProps: OwnProps
) => {
  // If the user updates the area of interest, the upsert of
  // the user metadata stored on backend is triggered
  const updateOrganizationsOfInterestMetadata = (
    selectedItemIds: Option<Set<string>>
  ) => {
    if (selectedItemIds.isSome() && stateProps.userMetadata) {
      const updatedAreasOfInterest = Array.from(selectedItemIds.value);
      dispatchProps.saveSelectedOrganizationItems(
        stateProps.userMetadata,
        updatedAreasOfInterest
      );
    }
  };

  return {
    ...stateProps,
    ...dispatchProps,
    ...ownProps,
    ...{
      updateOrganizationsOfInterestMetadata
    }
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
  mergeProps
)(withLightModalContext(ServicesHomeScreen));
